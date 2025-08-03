const technical = require('technicalindicators');

class SMA {
  constructor(config, logger, indicators) {
    this.config = config;
    this.logger = logger;
    this.indicators = indicators;
    this.signal = null;
  }

  async generateSignal(ohlcv) {
    try {
      const closes = ohlcv.map(c => c[4]);
      const sma = this.indicators.calculateSMA(ohlcv, this.config.sma.period);
      const rsi = this.indicators.calculateRSI(ohlcv);
      const currentPrice = closes[closes.length - 1];
      const lastPrice = closes[closes.length - 2];
      const currentSMA = sma[sma.length - 1];
      const currentRSI = rsi[rsi.length - 1];

      this.logger.info(`SMA Signal Check: Precio=${currentPrice}, SMA=${currentSMA}, RSI=${currentRSI}, Último Precio=${lastPrice}`);

      if (currentPrice > currentSMA && lastPrice <= currentSMA && currentRSI < 70) {
        this.signal = 'buy';
        this.logger.info(`Señal de compra SMA: Precio (${currentPrice}) cruzó por encima de SMA (${currentSMA}), RSI: ${currentRSI}`);
        return 'buy';
      } else if (currentPrice < currentSMA && lastPrice >= currentSMA && currentRSI > 30) {
        this.signal = 'sell';
        this.logger.info(`Señal de venta SMA: Precio (${currentPrice}) cruzó por debajo de SMA (${currentSMA}), RSI: ${currentRSI}`);
        return 'sell';
      }
      this.logger.info(`No se generó señal SMA: Precio=${currentPrice}, SMA=${currentSMA}, RSI=${currentRSI}`);
      return null;
    } catch (error) {
      this.logger.error(`Error generando señal SMA: ${error.message}`);
      return null;
    }
  }
}

module.exports = SMA;