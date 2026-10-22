/**
 * Technical indicator calculations — mirrors the Python version.
 * `history` is an array of {date, open, high, low, close, volume}, oldest first.
 */

function sma(values, window) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

function rsi(values, window = 14) {
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const avgGain = sma(gains, window);
  const avgLoss = sma(losses, window);
  return avgGain.map((g, i) => {
    const l = avgLoss[i];
    // No losses in the window: RSI is 100 if there were gains, and only
    // 50 (neutral) when the price didn't move at all. It used to return 50
    // in both cases, hiding a strongly overbought stock.
    if (l === 0) return g === 0 ? 50 : 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  });
}

function ema(values, span) {
  const k = 2 / (span + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  return { macdLine, signalLine };
}

function trendDirection(closes, sma20Series) {
  const lookback = Math.min(10, sma20Series.length - 1);
  if (lookback < 3) return { trend: "نامعلوم", trendEn: "Unknown", trendStrength: 0 };

  const recent = sma20Series[sma20Series.length - 1];
  const past = sma20Series[sma20Series.length - 1 - lookback];
  const slopePct = past ? Math.round(((recent - past) / past) * 1000) / 10 : 0;

  let trend, trendEn;
  if (slopePct > 1.5) {
    trend = "اوپر جا رہا ہے";
    trendEn = "Uptrend";
  } else if (slopePct < -1.5) {
    trend = "نیچے جا رہا ہے";
    trendEn = "Downtrend";
  } else {
    trend = "برابر / سائیڈ ویز";
    trendEn = "Sideways";
  }

  return { trend, trendEn, trendSlopePct: slopePct };
}

function computeSnapshot(history) {
  if (!history || history.length === 0) {
    throw new Error("Not enough data to compute indicators");
  }

  const closes = history.map((h) => h.close);
  const lastPrice = closes[closes.length - 1];

  const sma20Series = sma(closes, 20);
  const sma50Series = sma(closes, Math.min(50, closes.length));
  const rsiSeries = rsi(closes, 14);
  const { macdLine, signalLine } = macd(closes);

  const sma20 = sma20Series[sma20Series.length - 1];
  const sma50 = sma50Series[sma50Series.length - 1];
  const rsi14 = rsiSeries[rsiSeries.length - 1];
  const macdLast = macdLine[macdLine.length - 1];
  const macdSignalLast = signalLine[signalLine.length - 1];
  const trendInfo = trendDirection(closes, sma20Series);

  const highs = history.map((h) => h.high ?? h.close);
  const lows = history.map((h) => h.low ?? h.close);
  const recentWindow = 20;
  const recentHighs = highs.slice(-recentWindow);
  const recentLows = lows.slice(-recentWindow);
  const support = Math.min(...recentLows);
  const resistance = Math.max(...recentHighs);

  let score = 0;
  if (lastPrice > sma20) score += 1;
  if (sma20 > sma50) score += 1;
  if (rsi14 > 40 && rsi14 < 70) score += 1;
  if (rsi14 >= 70) score -= 1;
  if (rsi14 <= 30) score += 1;
  if (macdLast > macdSignalLast) score += 1;

  let position, positionEn, tradeable;
  if (score >= 3) {
    position = "مضبوط";
    positionEn = "Strong";
    tradeable = true;
  } else if (score <= 0) {
    position = "کمزور";
    positionEn = "Weak";
    tradeable = false;
  } else {
    position = "مستحکم";
    positionEn = "Stable";
    tradeable = score >= 2;
  }

  const upsidePct = lastPrice
    ? Math.round((((resistance - lastPrice) / lastPrice) * 100) * 10) / 10
    : 0;

  let recommendation, recommendationEn;
  if (score >= 3 && upsidePct > 3) {
    recommendation = "خریدیں";
    recommendationEn = "Buy";
  } else if (score <= 0 || upsidePct < 0) {
    recommendation = "نہ خریدیں";
    recommendationEn = "Don't buy";
  } else {
    recommendation = "انتظار کریں";
    recommendationEn = "Hold / wait";
  }

  return {
    dataPoints: closes.length,
    price: Math.round(lastPrice * 100) / 100,
    sma20: Math.round(sma20 * 100) / 100,
    sma50: Math.round(sma50 * 100) / 100,
    rsi14: Math.round(rsi14 * 10) / 10,
    macd: Math.round(macdLast * 1000) / 1000,
    macdSignal: Math.round(macdSignalLast * 1000) / 1000,
    support: Math.round(support * 100) / 100,
    resistance: Math.round(resistance * 100) / 100,
    position,
    positionEn,
    upsidePct,
    tradeable,
    recommendation,
    recommendationEn,
    score,
    trend: trendInfo.trend,
    trendEn: trendInfo.trendEn,
    trendSlopePct: trendInfo.trendSlopePct,
  };
}

function highLowPosition(history, lookbackDays) {
  const slice = history.slice(-lookbackDays);
  if (slice.length === 0) return null;

  const closes = slice.map((h) => h.close);
  const highs = slice.map((h) => h.high ?? h.close);
  const lows = slice.map((h) => h.low ?? h.close);

  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const last = closes[closes.length - 1];

  const pctFromHigh = high ? Math.round(((last - high) / high) * 1000) / 10 : 0;
  const pctFromLow = low ? Math.round(((last - low) / low) * 1000) / 10 : 0;

  let label, labelEn;
  if (pctFromHigh >= -5) {
    label = "بلند ترین سطح کے قریب";
    labelEn = "Near high";
  } else if (pctFromLow <= 5) {
    label = "کم ترین سطح کے قریب";
    labelEn = "Near low";
  } else {
    label = "درمیانی سطح";
    labelEn = "Mid-range";
  }

  return {
    high: Math.round(high * 100) / 100,
    low: Math.round(low * 100) / 100,
    pctFromHigh,
    pctFromLow,
    label,
    labelEn,
    tradingDaysUsed: slice.length,
  };
}

module.exports = { computeSnapshot, highLowPosition };
