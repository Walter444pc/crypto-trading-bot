const technical = require('technicalindicators');

class MeanReversion {
  constructor(config, logger, indicators) {
    this.config = config;
    this.logger = logger;
    this.indicators = indicators;
    this.signal = null;
  }

  async generateSignal(ohlcv) {
    try {
      const closes = ohlcv.map(c => c[4]);
      const sma = this.indicators.calculateSMA(ohlcv, this.config.meanReversion.period);
      const currentPrice = closes[closes.length - 1];
      const lastPrice = closes[closes.length - 2];
      const currentSMA = sma[sma.length - 1];
      const upperBound = currentSMA * (1 + this.config.meanReversion.offset / 100);
      const lowerBound = currentSMA * (1 - this.config.meanReversion.offset / 100);

      this.logger.info(`MeanReversion Signal Check: Precio=${currentPrice}, SMA=${currentSMA}, UpperBound=${upperBound}, LowerBound=${lowerBound}, Último Precio=${lastPrice}`);

      if (currentPrice > upperBound && lastPrice <= upperBound) {
        this.signal = 'sell';
        this.logger.info(`Señal de venta Mean Reversion: Precio (${currentPrice}) cruzó por encima de límite superior (${upperBound})`);
        return 'sell';
      } else if (currentPrice < lowerBound && lastPrice >= lowerBound) {
        this.signal = 'buy';
        this.logger.info(`Señal de compra Mean Reversion: Precio (${currentPrice}) cruzó por debajo de límite inferior (${lowerBound})`);
        return 'buy';
      }
      this.logger.info(`No se generó señal Mean Reversion: Precio=${currentPrice}, SMA=${currentSMA}, UpperBound=${upperBound}, LowerBound=${lowerBound}`);
      return null;
    } catch (error) {
      this.logger.error(`Error generando señal Mean Reversion: ${error.message}`);
      return null;
    }
  }
}

module.exports = MeanReversion;