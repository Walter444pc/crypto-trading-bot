const technical = require('technicalindicators');
const retry = require('async-retry');

class MarketConditions {
  constructor(config, exchange, logger) {
    this.config = config;
    this.exchange = exchange;
    this.logger = logger;
  }

  async evaluate(ohlcv) {
    try {
      const closes = ohlcv.map(c => c[4]);
      const adx = technical.ADX.calculate({
        period: 14,
        high: ohlcv.map(c => c[2]),
        low: ohlcv.map(c => c[3]),
        close: closes
      });
      const atr = technical.ATR.calculate({
        period: 14,
        high: ohlcv.map(c => c[2]),
        low: ohlcv.map(c => c[3]),
        close: closes
      });
      const currentADX = adx[adx.length - 1]?.adx || 0;
      const currentATR = atr[atr.length - 1] || closes[closes.length - 1] * 0.01;

      return currentADX > 25
        ? currentATR > closes[closes.length - 1] * 0.01
          ? 'trending_volatile'
          : 'trending_stable'
        : currentATR > closes[closes.length - 1] * 0.01
          ? 'ranging_volatile'
          : 'ranging_stable';
    } catch (error) {
      this.logger.error(`Error evaluando condiciones de mercado: ${error.message}`);
      return 'ranging_stable'; // Fallback
    }
  }

  recommendStrategy(condition) {
    switch (condition) {
      case 'trending_volatile':
      case 'trending_stable':
        return 'ema';
      case 'ranging_volatile':
      case 'ranging_stable':
        return 'meanReversion';
      default:
        return 'sma';
    }
  }

  async selectBestPairs() {
    try {
      const markets = await retry(() => this.exchange.loadMarkets(), { retries: 5, minTimeout: 1000, factor: 2 });
      const symbols = Object.keys(markets).filter(s => s.endsWith(`/${this.config.baseCurrency}`));
      const topPairs = [];
      
      for (const symbol of symbols.slice(0, 50)) {
        try {
          const ticker = await retry(() => this.exchange.fetchTicker(symbol), { retries: 3, minTimeout: 1000, factor: 2 });
          const ohlcv = await retry(() => this.exchange.fetchOHLCV(symbol, '1h', undefined, 24), { retries: 3, minTimeout: 1000, factor: 2 });
          const orderBook = await retry(() => this.exchange.fetchOrderBook(symbol, 20), { retries: 3, minTimeout: 1000, factor: 2 });

          const adx = technical.ADX.calculate({
            period: 14,
            high: ohlcv.map(c => c[2]),
            low: ohlcv.map(c => c[3]),
            close: ohlcv.map(c => c[4])
          });
          const atr = technical.ATR.calculate({
            period: 14,
            high: ohlcv.map(c => c[2]),
            low: ohlcv.map(c => c[3]),
            close: ohlcv.map(c => c[4])
          });
          const return24h = (ticker.last - ohlcv[0][4]) / ohlcv[0][4];
          const liquidity = orderBook.bids.reduce((sum, [_, vol]) => sum + vol, 0) + orderBook.asks.reduce((sum, [_, vol]) => sum + vol, 0);

          topPairs.push({
            symbol,
            score: (adx[adx.length - 1]?.adx * 0.4 || 0) + (atr[atr.length - 1] / ticker.last * 0.3 || 0) + (return24h * 0.2) + (liquidity > 100 ? 0.1 : 0)
          });
        } catch (error) {
          this.logger.warn(`Error evaluando ${symbol}: ${error.message}`);
        }
      }

      const selected = topPairs
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.autoSelection.maxPairs)
        .map(p => p.symbol);
      return selected.length > 0 ? selected : [this.config.symbol];
    } catch (error) {
      this.logger.error(`Error seleccionando pares: ${error.message}`);
      return [this.config.symbol];
    }
  }
}

module.exports = MarketConditions;