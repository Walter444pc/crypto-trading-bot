const technical = require('technicalindicators');

class EMA {
  constructor(config, logger, indicators) {
    this.config = config;
    this.logger = logger;
    this.indicators = indicators;
    this.signal = null;
  }

  async generateSignal(ohlcv) {
    try {
      const closes = ohlcv.map(c => c[4]);
      const ema = this.indicators.calculateEMA(ohlcv, this.config.ema.period);
      const macd = this.indicators.calculateMACD(ohlcv);
      const currentPrice = closes[closes.length - 1];
      const lastPrice = closes[closes.length - 2];
      const currentEMA = ema[ema.length - 1];
      const currentMACD = macd[macd.length - 1];

      this.logger.info(`EMA Signal Check: Precio=${currentPrice}, EMA=${currentEMA}, MACD=${currentMACD.macd}, Signal=${currentMACD.signal}, Último Precio=${lastPrice}`);

      if (currentPrice > currentEMA && lastPrice <= currentEMA && currentMACD.macd > currentMACD.signal) {
        this.signal = 'buy';
        this.logger.info(`Señal de compra EMA: Precio (${currentPrice}) cruzó por encima de EMA (${currentEMA}), MACD: ${currentMACD.macd}`);
        return 'buy';
      } else if (currentPrice < currentEMA && lastPrice >= currentEMA && currentMACD.macd < currentMACD.signal) {
        this.signal = 'sell';
        this.logger.info(`Señal de venta EMA: Precio (${currentPrice}) cruzó por debajo de EMA (${currentEMA}), MACD: ${currentMACD.macd}`);
        return 'sell';
      }
      this.logger.info(`No se generó señal EMA: Precio=${currentPrice}, EMA=${currentEMA}, MACD=${currentMACD.macd}`);
      return null;
    } catch (error) {
      this.logger.error(`Error generando señal EMA: ${error.message}`);
      return null;
    }
  }
}

module.exports = EMA;