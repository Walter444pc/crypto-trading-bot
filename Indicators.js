const technical = require('technicalindicators');

class Indicators {
  constructor(config) {
    this.config = config;
    this.cache = {};
  }

  calculateSMA(ohlcv, period) {
    const closes = ohlcv.map(c => c[4]);
    return technical.SMA.calculate({ period, values: closes });
  }

  calculateEMA(ohlcv, period) {
    const closes = ohlcv.map(c => c[4]);
    return technical.EMA.calculate({ period, values: closes });
  }

  calculateRSI(ohlcv) {
    const closes = ohlcv.map(c => c[4]);
    return technical.RSI.calculate({ period: this.config.indicators.rsiPeriod, values: closes });
  }

  calculateMACD(ohlcv) {
    const closes = ohlcv.map(c => c[4]);
    return technical.MACD.calculate({
      fastPeriod: this.config.indicators.macdFast,
      slowPeriod: this.config.indicators.macdSlow,
      signalPeriod: this.config.indicators.macdSignal,
      values: closes
    });
  }

  calculateBollingerBands(ohlcv) {
    const closes = ohlcv.map(c => c[4]);
    return technical.BollingerBands.calculate({
      period: this.config.indicators.bollingerPeriod,
      stdDev: this.config.indicators.bollingerStdDev,
      values: closes
    });
  }

  calculateVWAP(ohlcv) {
    const typicalPrices = ohlcv.map(c => (c[2] + c[3] + c[4]) / 3);
    const volumes = ohlcv.map(c => c[5]);
    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;
    const vwap = [];
    for (let i = 0; i < typicalPrices.length; i++) {
      cumulativePriceVolume += typicalPrices[i] * volumes[i];
      cumulativeVolume += volumes[i];
      vwap.push(cumulativePriceVolume / cumulativeVolume);
    }
    return vwap;
  }

  calculateIchimoku(ohlcv) {
    const highs = ohlcv.map(c => c[2]);
    const lows = ohlcv.map(c => c[3]);
    const tenkanSen = technical.SMA.calculate({ period: 9, values: highs.map((h, i) => (h + lows[i]) / 2) });
    const kijunSen = technical.SMA.calculate({ period: 26, values: highs.map((h, i) => (h + lows[i]) / 2) });
    return { tenkanSen: tenkanSen[tenkanSen.length - 1], kijunSen: kijunSen[kijunSen.length - 1] };
  }

  calculateADX(ohlcv) {
    return technical.ADX.calculate({
      period: 14,
      high: ohlcv.map(c => c[2]),
      low: ohlcv.map(c => c[3]),
      close: ohlcv.map(c => c[4])
    });
  }

  calculateATR(ohlcv) {
    return technical.ATR.calculate({
      period: 14,
      high: ohlcv.map(c => c[2]),
      low: ohlcv.map(c => c[3]),
      close: ohlcv.map(c => c[4])
    });
  }
}

module.exports = Indicators;