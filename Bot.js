const ccxt = require('ccxt');
const retry = require('async-retry');
const Indicators = require('./Indicators');
const MarketConditions = require('./MarketConditions');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');
require('dotenv').config();

class TradingBot {
  constructor(io) {
    this.io = io;
    this.config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    this.exchange = this.config.mode === 'real'
      ? new ccxt[this.config.exchange]({ apiKey: process.env.API_KEY, secret: process.env.API_SECRET, enableRateLimit: true })
      : new ccxt[this.config.exchange]({ enableRateLimit: true });
    this.running = false;
    this.balance = this.config.mode === 'simulation' ? { [this.config.baseCurrency]: this.config.fictionalBalance[this.config.baseCurrency] || 10000 } : null;
    this.indicators = new Indicators(this.config);
    this.marketConditions = new MarketConditions(this.config, this.exchange, this.logger);
    this.logger = winston.createLogger({
      transports: [
        new DailyRotateFile({
          filename: 'logs/bot-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxFiles: '7d',
          maxSize: '20m'
        }),
        new winston.transports.Console()
      ],
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
      )
    });
    this.strategy = this.loadStrategy(this.config.strategy);
    this.orderBookCache = {};
    this.feesCache = {};
    this.feesCacheTimestamp = {};
    this.selectedSymbols = this.config.selectionMode === 'manual' ? [this.config.symbol] : [];

    this.logger.on('message', (info) => {
      console.log(`Emitting log to client: ${info.timestamp} [${info.level}]: ${info.message}`);
      this.io.emit('log', { timestamp: info.timestamp, level: info.level, message: info.message });
    });
  }

  async loadFees(symbol) {
    const now = Date.now();
    if (this.feesCache[symbol] && this.feesCacheTimestamp[symbol] && now - this.feesCacheTimestamp[symbol] < this.config.feesCacheDuration) {
      return this.feesCache[symbol];
    }
    try {
      const markets = await retry(() => this.exchange.loadMarkets(), { retries: 5, minTimeout: 2000, factor: 2 });
      if (markets[symbol] && markets[symbol].taker) {
        this.feesCache[symbol] = markets[symbol].taker;
        this.feesCacheTimestamp[symbol] = now;
        this.logger.info(`Fee para ${symbol}: ${this.feesCache[symbol] * 100}%`);
      } else {
        this.feesCache[symbol] = this.config.risk.defaultTradingFee;
        this.feesCacheTimestamp[symbol] = now;
        this.logger.warn(`No se encontraron fees para ${symbol}, usando default: ${this.feesCache[symbol] * 100}%`);
      }
      return this.feesCache[symbol];
    } catch (error) {
      this.logger.error(`Error cargando fees para ${symbol}: ${error.message}`);
      this.feesCache[symbol] = this.config.risk.defaultTradingFee;
      this.feesCacheTimestamp[symbol] = now;
      return this.config.risk.defaultTradingFee;
    }
  }

  loadStrategy(strategyName) {
    const strategies = {
      sma: require('./strategies/SMA'),
      ema: require('./strategies/EMA'),
      meanReversion: require('./strategies/MeanReversion'),
      pairsTrading: require('./strategies/PairsTrading')
    };
    return new strategies[strategyName](this.config, this.logger, this.indicators);
  }

  async start() {
    if (this.running) {
      this.logger.info('El bot ya está en ejecución');
      return false;
    }
    if (!process.env.API_KEY || !process.env.API_SECRET) {
      this.logger.error('API_KEY o API_SECRET no configurados en .env');
      return false;
    }
    this.running = true;
    this.logger.info('Bot iniciado');
    this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });

    if (this.config.mode === 'real') {
      try {
        this.balance = await retry(() => this.exchange.fetchBalance(), { retries: 5, minTimeout: 2000, factor: 2 });
        this.logger.info(`Balance real: ${JSON.stringify(this.balance.total)}`);
        this.io.emit('balance', this.balance.total);
      } catch (error) {
        this.logger.error(`Error cargando balance real: ${error.message}`);
        this.running = false;
        this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });
        return false;
      }
    } else {
      this.logger.info(`Balance ficticio: ${JSON.stringify(this.balance)}`);
      this.io.emit('balance', this.balance);
    }

    if (this.config.selectionMode === 'auto') {
      this.selectedSymbols = await this.marketConditions.selectBestPairs();
      this.logger.info(`Pares seleccionados automáticamente: ${this.selectedSymbols.join(', ')}`);
      this.io.emit('pairs', this.selectedSymbols.map(s => [s, 'N/A']));
    }

    for (const symbol of this.selectedSymbols) {
      await this.loadFees(symbol);
    }

    this.interval = setInterval(() => this.execute(), 60 * 1000);
    this.autoSelectionInterval = this.config.selectionMode === 'auto'
      ? setInterval(() => this.updateSelectedPairs(), this.config.autoSelection.evaluationInterval)
      : null;
    return true;
  }

  async updateSelectedPairs() {
    try {
      const newSymbols = await this.marketConditions.selectBestPairs();
      if (newSymbols.join() !== this.selectedSymbols.join()) {
        this.logger.info(`Actualizando pares: ${newSymbols.join(', ')}`);
        this.selectedSymbols = newSymbols;
        for (const symbol of newSymbols) {
          await this.loadFees(symbol);
        }
        this.io.emit('pairs', this.selectedSymbols.map(s => [s, 'N/A']));
      }
    } catch (error) {
      this.logger.error(`Error actualizando pares: ${error.message}`);
    }
  }

  stop() {
    if (!this.running) {
      this.logger.info('El bot ya está parado');
      this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });
      return false;
    }
    this.running = false;
    clearInterval(this.interval);
    clearInterval(this.autoSelectionInterval);
    this.logger.info('Bot detenido');
    this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });
    return true;
  }

  async liquidate() {
    if (this.running) {
      this.logger.info('Debe detener el bot para liquidar');
      return false;
    }
    this.logger.info('Liquidando posiciones...');
    if (this.config.mode === 'real') {
      try {
        const positions = await retry(() => this.exchange.fetchPositions(this.selectedSymbols), { retries: 5, minTimeout: 2000, factor: 2 });
        for (const pos of positions) {
          const fee = await this.loadFees(pos.symbol);
          await retry(() => this.exchange.createMarketOrder(pos.symbol, pos.side === 'long' ? 'sell' : 'buy', pos.contracts), { retries: 5, minTimeout: 2000, factor: 2 });
          this.logger.info(`Posición cerrada para ${pos.symbol}, fee: ${fee * 100}%`);
        }
        this.balance = await retry(() => this.exchange.fetchBalance(), { retries: 5, minTimeout: 2000, factor: 2 });
        this.logger.info('Posiciones cerradas en modo real');
        this.io.emit('balance', this.balance.total);
      } catch (error) {
        this.logger.error(`Error liquidando posiciones: ${error.message}`);
        return false;
      }
    } else {
      for (const symbol of this.selectedSymbols) {
        const asset = symbol.split('/')[0];
        if (this.balance[asset]) {
          try {
            const price = (await retry(() => this.exchange.fetchTicker(symbol), { retries: 3, minTimeout: 2000, factor: 2 })).last || this.orderBookCache[symbol]?.last || 1;
            const fee = await this.loadFees(symbol);
            this.balance[this.config.baseCurrency] += (this.balance[asset] * price) * (1 - fee);
            this.balance[asset] = 0;
            this.logger.info(`Posición liquidada para ${symbol}, fee: ${fee * 100}%`);
          } catch (error) {
            this.logger.error(`Error liquidando ${symbol}: ${error.message}`);
          }
        }
      }
      this.logger.info('Posiciones liquidadas en modo simulación');
      this.io.emit('balance', this.balance);
    }
    return true;
  }

  switchMode() {
    if (this.running) {
      this.logger.info('Debe detener el bot para cambiar de modo');
      return false;
    }
    this.config.mode = this.config.mode === 'simulation' ? 'real' : 'simulation';
    this.exchange = this.config.mode === 'real'
      ? new ccxt[this.config.exchange]({ apiKey: process.env.API_KEY, secret: process.env.API_SECRET, enableRateLimit: true })
      : new ccxt[this.config.exchange]({ enableRateLimit: true });
    this.balance = this.config.mode === 'simulation' ? { [this.config.baseCurrency]: this.config.fictionalBalance[this.config.baseCurrency] || 10000 } : null;
    this.logger.info(`Cambiado a modo ${this.config.mode}`);
    fs.writeFileSync('config.json', JSON.stringify(this.config, null, 2));
    this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });
    this.io.emit('balance', this.balance);
    return true;
  }

  setStrategy(strategy) {
    if (!['sma', 'ema', 'meanReversion', 'pairsTrading'].includes(strategy)) {
      this.logger.error(`Estrategia no válida: ${strategy}`);
      return false;
    }
    this.config.strategy = strategy;
    this.strategy = this.loadStrategy(strategy);
    fs.writeFileSync('config.json', JSON.stringify(this.config, null, 2));
    this.logger.info(`Estrategia cambiada a ${strategy}`);
    this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });
    return true;
  }

  setSelectionMode(mode) {
    if (this.running) {
      this.logger.info('Debe detener el bot para cambiar el modo de selección');
      return false;
    }
    const normalizedMode = mode.toLowerCase();
    const validModes = ['manual', 'auto', 'automatic'];
    if (!validModes.includes(normalizedMode)) {
      this.logger.error(`Modo de selección no válido: ${mode}`);
      return false;
    }
    this.config.selectionMode = normalizedMode === 'automatic' ? 'auto' : normalizedMode;
    fs.writeFileSync('config.json', JSON.stringify(this.config, null, 2));
    this.logger.info(`Modo de selección cambiado a ${this.config.selectionMode}`);
    this.io.emit('status', { running: this.running, mode: this.config.mode, selectionMode: this.config.selectionMode, exchange: this.config.exchange, strategy: this.config.strategy });
    return true;
  }

  async setSymbol(symbol) {
    if (this.running) {
      this.logger.info('Debe detener el bot para cambiar el símbolo');
      return false;
    }
    try {
      await retry(() => this.exchange.loadMarkets(), { retries: 5, minTimeout: 2000, factor: 2 });
      if (!this.exchange.markets[symbol]) {
        this.logger.error(`Símbolo no válido: ${symbol}`);
        return false;
      }
      this.config.symbol = symbol;
      this.selectedSymbols = [symbol];
      await this.loadFees(symbol);
      fs.writeFileSync('config.json', JSON.stringify(this.config, null, 2));
      this.logger.info(`Símbolo establecido: ${symbol}`);
      this.io.emit('pairs', this.selectedSymbols.map(s => [s, 'N/A']));
      return true;
    } catch (error) {
      this.logger.error(`Error estableciendo símbolo ${symbol}: ${error.message}`);
      return false;
    }
  }

  async checkLiquidity(symbol) {
    try {
      const retries = symbol === 'BTC/USDT' ? 20 : 5;
      const orderBook = await retry(() => this.exchange.fetchOrderBook(symbol, 100), { retries, minTimeout: 3000, factor: 2 });
      this.logger.info(`Raw order book for ${symbol}: Bids=${JSON.stringify(orderBook.bids.slice(0, 5))}, Asks=${JSON.stringify(orderBook.asks.slice(0, 5))}`);
      this.orderBookCache[symbol] = orderBook;
      const bidVolume = orderBook.bids.length > 0 ? orderBook.bids.reduce((sum, [_, vol]) => sum + vol, 0) : 0;
      const askVolume = orderBook.asks.length > 0 ? orderBook.asks.reduce((sum, [_, vol]) => sum + vol, 0) : 0;
      const liquidityThreshold = symbol === 'BTC/USDT' ? 100 : 100; // Increased threshold for consistency
      this.logger.info(`Liquidez para ${symbol}: Bid=${bidVolume}, Ask=${askVolume}, Umbral=${liquidityThreshold}`);
      if (bidVolume < liquidityThreshold || askVolume < liquidityThreshold) {
        this.logger.warn(`Baja liquidez detectada para ${symbol}: Bid=${bidVolume}, Ask=${askVolume}`);
        return false;
      }
      this.io.emit('liquidity', { symbol, bid: bidVolume, ask: askVolume });
      return true;
    } catch (error) {
      this.logger.error(`Error al verificar liquidez para ${symbol}: ${error.message}`);
      return false;
    }
  }

  async execute() {
    try {
      for (const symbol of this.selectedSymbols) {
        if (!(await this.checkLiquidity(symbol))) {
          this.logger.warn(`Ejecución cancelada para ${symbol} por baja liquidez`);
          continue;
        }

        const ohlcv = await retry(() => this.exchange.fetchOHLCV(symbol, this.config.timeframe, undefined, this.config[this.config.strategy].period + 1), { retries: 5, minTimeout: 2000, factor: 2 });
        const condition = await this.marketConditions.evaluate(ohlcv);
        const recommendedStrategy = this.marketConditions.recommendStrategy(condition);
        if (recommendedStrategy !== this.config.strategy) {
          this.logger.info(`Cambiando estrategia a ${recommendedStrategy} para ${symbol} debido a condición: ${condition}`);
          if (this.setStrategy(recommendedStrategy)) {
            this.logger.info(`Estrategia cambiada exitosamente a ${recommendedStrategy} para ${symbol}`);
          } else {
            this.logger.warn(`No se pudo cambiar la estrategia para ${symbol}`);
          }
        }

        let signal = null;
        if (this.config.strategy === 'pairsTrading') {
          const ohlcv2 = await retry(() => this.exchange.fetchOHLCV(this.config.pairsTrading.symbol2, this.config.timeframe, undefined, this.config.pairsTrading.period + 1), { retries: 5, minTimeout: 2000, factor: 2 });
          signal = await this.strategy.generateSignal(ohlcv, ohlcv2);
        } else {
          signal = await this.strategy.generateSignal(ohlcv);
        }

        if (signal) {
          const price = ohlcv[ohlcv.length - 1][4] || this.orderBookCache[symbol]?.last || 1;
          const positionSize = this.calculatePositionSize(price, symbol);
          
          if (signal === 'buy' || signal === 'sell') {
            await this.executeOrder(signal, positionSize, price, symbol);
          } else if (signal === 'sell1_buy2' || signal === 'buy1_sell2') {
            await this.executePairsOrder(signal, positionSize);
          }
        }
      }
      this.io.emit('balance', this.config.mode === 'real' ? this.balance.total : this.balance);
      await this.updateCharts();
    } catch (error) {
      this.logger.error(`Error en ejecución: ${error.message}`);
    }
  }

  calculatePositionSize(price, symbol) {
    const asset = symbol.split('/')[0];
    const balanceValue = this.config.mode === 'real'
      ? this.balance.total[this.config.baseCurrency] || 0
      : this.balance[this.config.baseCurrency] || 0;
    return Math.min(balanceValue * this.config.risk.maxPositionSize / (price || 1), this.balance[asset] || Infinity);
  }

  async executeOrder(side, amount, price, symbol) {
    try {
      const asset = symbol.split('/')[0];
      const fee = await this.loadFees(symbol);
      if (this.config.mode === 'real') {
        await retry(() => this.exchange.createMarketOrder(symbol, side, amount), { retries: 5, minTimeout: 2000, factor: 2 });
        this.logger.info(`Ejecutando ${side}: ${symbol}, cantidad: ${amount}, precio: ${price}, fee: ${fee * 100}%`);
      } else {
        const feeAmount = amount * price * fee;
        if (side === 'buy') {
          if (this.balance[this.config.baseCurrency] < amount * price + feeAmount) {
            this.logger.error(`Fondos insuficientes para comprar ${amount} ${symbol} a ${price}`);
            return;
          }
          this.balance[asset] = (this.balance[asset] || 0) + amount;
          this.balance[this.config.baseCurrency] -= (amount * price + feeAmount);
        } else {
          if (!this.balance[asset] || this.balance[asset] < amount) {
            this.logger.error(`Fondos insuficientes para vender ${amount} ${symbol}`);
            return;
          }
          this.balance[asset] -= amount;
          this.balance[this.config.baseCurrency] += (amount * price - feeAmount);
        }
        this.logger.info(`Ejecutando simulación ${side}: ${symbol}, cantidad: ${amount}, precio: ${price}, fee: ${feeAmount} (${fee * 100}%)`);
      }
      this.applyRiskManagement(price, symbol);
      this.io.emit('balance', this.config.mode === 'real' ? this.balance.total : this.balance);
    } catch (error) {
      this.logger.error(`Error ejecutando orden para ${symbol}: ${error.message} (${error.name})`);
      if (error.name === 'InsufficientFunds') {
        this.logger.warn(`Fondos insuficientes en exchange para ${symbol}`);
      } else if (error.name === 'NetworkError') {
        this.logger.warn(`Error de red al ejecutar orden para ${symbol}, reintentando en próximo ciclo`);
      }
    }
  }

  async executePairsOrder(signal, amount) {
    try {
      const price1 = (await retry(() => this.exchange.fetchTicker(this.config.pairsTrading.symbol1), { retries: 5, minTimeout: 2000, factor: 2 })).last || this.orderBookCache[this.config.pairsTrading.symbol1]?.last || 1;
      const price2 = (await retry(() => this.exchange.fetchTicker(this.config.pairsTrading.symbol2), { retries: 5, minTimeout: 2000, factor: 2 })).last || this.orderBookCache[this.config.pairsTrading.symbol2]?.last || 1;
      const asset1 = this.config.pairsTrading.symbol1.split('/')[0];
      const asset2 = this.config.pairsTrading.symbol2.split('/')[0];
      const fee1 = await this.loadFees(this.config.pairsTrading.symbol1);
      const fee2 = await this.loadFees(this.config.pairsTrading.symbol2);

      if (this.config.mode === 'real') {
        if (signal === 'sell1_buy2') {
          await retry(() => this.exchange.createMarketOrder(this.config.pairsTrading.symbol1, 'sell', amount), { retries: 5, minTimeout: 2000, factor: 2 });
          await retry(() => this.exchange.createMarketOrder(this.config.pairsTrading.symbol2, 'buy', amount * price1 / price2), { retries: 5, minTimeout: 2000, factor: 2 });
        } else {
          await retry(() => this.exchange.createMarketOrder(this.config.pairsTrading.symbol1, 'buy', amount), { retries: 5, minTimeout: 2000, factor: 2 });
          await retry(() => this.exchange.createMarketOrder(this.config.pairsTrading.symbol2, 'sell', amount * price1 / price2), { retries: 5, minTimeout: 2000, factor: 2 });
        }
        this.logger.info(`Orden de pares ejecutada: ${signal}, fees: ${fee1 * 100}%/${fee2 * 100}%`);
      } else {
        const feeAmount1 = amount * price1 * fee1;
        const feeAmount2 = (amount * price1 / price2) * price2 * fee2;
        if (signal === 'sell1_buy2') {
          if (!this.balance[asset1] || this.balance[asset1] < amount || this.balance[this.config.baseCurrency] < feeAmount1 + feeAmount2) {
            this.logger.error(`Fondos insuficientes para orden de pares sell1_buy2`);
            return;
          }
          this.balance[asset1] = (this.balance[asset1] || 0) - amount;
          this.balance[asset2] = (this.balance[asset2] || 0) + (amount * price1 / price2);
          this.balance[this.config.baseCurrency] += (amount * price1 - feeAmount1 - feeAmount2);
        } else {
          if (!this.balance[asset2] || this.balance[asset2] < amount * price1 / price2 || this.balance[this.config.baseCurrency] < amount * price1 + feeAmount1 + feeAmount2) {
            this.logger.error(`Fondos insuficientes para orden de pares buy1_sell2`);
            return;
          }
          this.balance[asset1] = (this.balance[asset1] || 0) + amount;
          this.balance[asset2] = (this.balance[asset2] || 0) - (amount * price1 / price2);
          this.balance[this.config.baseCurrency] -= (amount * price1 + feeAmount1 + feeAmount2);
        }
        this.logger.info(`Orden simulada de pares: ${signal}, fees: ${feeAmount1 + feeAmount2} (${fee1 * 100}%/${fee2 * 100}%)`);
      }
      this.applyRiskManagement(price1, this.config.pairsTrading.symbol1);
      this.io.emit('balance', this.config.mode === 'real' ? this.balance.total : this.balance);
    } catch (error) {
      this.logger.error(`Error ejecutando orden de pares: ${error.message} (${error.name})`);
    }
  }

  applyRiskManagement(price, symbol) {
    const stopLossPrice = price * (1 - (this.config.risk.stopLossPercent * (this.strategy.signal === 'buy' ? 1 : -1)));
    const takeProfitPrice = price * (1 + (this.config.risk.takeProfitPercent * (this.strategy.signal === 'buy' ? 1 : -1)));
    this.logger.info(`Stop-loss para ${symbol}: ${stopLossPrice}, Take-profit: ${takeProfitPrice}`);
  }

  async updateCharts() {
    try {
      const symbol = this.selectedSymbols[0] || this.config.symbol;
      const limit = process.stdout.columns < 768 ? 5 : 10;
      const ohlcv = await retry(() => this.exchange.fetchOHLCV(symbol, this.config.timeframe, undefined, limit), { retries: 5, minTimeout: 2000, factor: 2 });
      const candleData = ohlcv.map(c => ({
        x: new Date(c[0]).toLocaleTimeString(),
        close: c[4]
      }));
      this.io.emit('candles', { symbol, data: candleData });

      const price = ohlcv[ohlcv.length - 1][4] || this.orderBookCache[symbol]?.last || 1;
      const totalValue = Object.entries(this.config.mode === 'real' ? this.balance.total : this.balance).reduce((sum, [asset, amount]) => {
        if (asset === this.config.baseCurrency) return sum + amount;
        const ticker = this.orderBookCache[`${asset}/${this.config.baseCurrency}`]?.last || price;
        return sum + amount * ticker;
      }, 0);
      const pieData = Object.entries(this.config.mode === 'real' ? this.balance.total : this.balance).map(([asset, amount]) => {
        const value = asset === this.config.baseCurrency ? amount : amount * (this.orderBookCache[`${asset}/${this.config.baseCurrency}`]?.last || price);
        return { percent: totalValue ? (value / totalValue) * 100 : 0, label: asset, color: asset === this.config.baseCurrency ? '#00ff00' : '#ffff00' };
      });
      this.io.emit('pie', pieData);

      const rsi = this.indicators.calculateRSI(ohlcv);
      const macd = this.indicators.calculateMACD(ohlcv);
      const bollinger = this.indicators.calculateBollingerBands(ohlcv);
      const vwap = this.indicators.calculateVWAP(ohlcv);
      const ichimoku = this.indicators.calculateIchimoku(ohlcv);
      this.io.emit('indicators', [
        ['RSI', rsi[rsi.length - 1]?.toFixed(2) || 'N/A'],
        ['MACD', macd[macd.length - 1]?.macd.toFixed(2) || 'N/A'],
        ['Bollinger Upper', bollinger[bollinger.length - 1]?.upper.toFixed(2) || 'N/A'],
        ['VWAP', vwap[vwap.length - 1]?.toFixed(2) || 'N/A'],
        ['Ichimoku Tenkan', ichimoku.tenkanSen?.toFixed(2) || 'N/A']
      ]);
    } catch (error) {
      this.logger.error(`Error actualizando gráficos: ${error.message}`);
    }
  }
}

module.exports = TradingBot;