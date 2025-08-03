const technical = require('technicalindicators');

class PairsTrading {
  constructor(config, logger, indicators) {
    this.config = config;
    this.logger = logger;
    this.indicators = indicators;
    this.signal = null;
  }

  async generateSignal(ohlcv1, ohlcv2) {
    try {
      const closes1 = ohlcv1.map(c => c[4]);
      const closes2 = ohlcv2.map(c => c[4]);
      const diff = closes1.map((p, i) => p - closes2[i]);
      const meanDiff = diff.reduce((sum, val) => sum + val, 0) / diff.length;
      const stdDiff = Math.sqrt(diff.reduce((sum, val) => sum + Math.pow(val - meanDiff, 2), 0) / diff.length);
      const zScore = (diff[diff.length - 1] - meanDiff) / (stdDiff || 1);
      const rsi = this.indicators.calculateRSI(ohlcv1);
      const currentZScore = zScore;
      const lastZScore = (diff[diff.length - 2] - meanDiff) / (stdDiff || 1);
      const currentRSI = rsi[rsi.length - 1];
      const upperBound = this.config.pairsTrading.offset / 100;
      const lowerBound = -this.config.pairsTrading.offset / 100;

      this.logger.info(`PairsTrading Signal Check: Z-Score=${currentZScore}, RSI=${currentRSI}, Último Z-Score=${lastZScore}, UpperBound=${upperBound}, LowerBound=${lowerBound}`);

      if (currentZScore > upperBound && lastZScore <= upperBound && currentRSI < 70) {
        this.signal = 'sell1_buy2';
        this.logger.info(`Señal Pairs Trading: Vender ${this.config.pairsTrading.symbol1}, Comprar ${this.config.pairsTrading.symbol2}, Z-Score: ${currentZScore}, RSI: ${currentRSI}`);
        return 'sell1_buy2';
      } else if (currentZScore < lowerBound && lastZScore >= lowerBound && currentRSI > 30) {
        this.signal = 'buy1_sell2';
        this.logger.info(`Señal Pairs Trading: Comprar ${this.config.pairsTrading.symbol1}, Vender ${this.config.pairsTrading.symbol2}, Z-Score: ${currentZScore}, RSI: ${currentRSI}`);
        return 'buy1_sell2';
      }
      this.logger.info(`No se generó señal Pairs Trading: Z-Score=${currentZScore}, RSI=${currentRSI}`);
      return null;
    } catch (error) {
      this.logger.error(`Error generando señal Pairs Trading: ${error.message}`);
      return null;
    }
  }
}

module.exports = PairsTrading;