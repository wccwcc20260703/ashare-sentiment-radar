export type PriceBar = {
  day: string;
  open?: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
};

export type VixFixSignal = "add" | "empty";

export type VixFixSignalDetail = {
  signal: VixFixSignal;
  signalLabel: "买点" | "卖点";
  reason: string;
  vixFix: number;
  inverseVixFix: number;
  stochasticK: number;
  stochasticD: number;
  referenceStop: number;
  sourceRule: string;
};

export type VixFixIndicatorPoint = {
  date: string;
  vixFix: number;
  inverseVixFix: number;
  stochasticK: number;
  stochasticD: number;
  bottomSpike: boolean;
  topSpike: boolean;
};

const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : Number.NaN;

function rollingAverage(values: number[], end: number, window: number) {
  if (end < window - 1) return Number.NaN;
  return average(values.slice(end - window + 1, end + 1));
}

function rollingStandardDeviation(
  values: number[],
  end: number,
  window: number,
) {
  if (end < window - 1) return Number.NaN;
  const sample = values.slice(end - window + 1, end + 1);
  const mean = average(sample);
  return Math.sqrt(
    sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      sample.length,
  );
}

function recentExtreme(
  values: number[],
  end: number,
  window: number,
  mode: "min" | "max",
) {
  const sample = values.slice(Math.max(0, end - window + 1), end + 1);
  return mode === "min" ? Math.min(...sample) : Math.max(...sample);
}

/**
 * 小红书视频中明确展示的双重确认：
 * 1. 原版 Williams VIX Fix 出现绿色柱，提示潜在底部；
 * 2. 随机指标进入超卖区，K 线上穿 D 线才形成买点；
 * 3. 顶部使用反向 VIX Fix，随机指标在超买区死叉形成卖点。
 *
 * VIX Fix 参数采用 Chris Moody 公版常用默认值：22 / 20 / 2 / 50 / 0.85。
 * 视频没有给出两个指标允许相隔几根 K 线，量化时透明固定为 8 个交易日；
 * 每个 VIX Fix 波动峰只允许被确认一次，避免连续重复标点。
 */
export function buildVixFixSignals(bars: PriceBar[]) {
  const closes = bars.map((bar) => Number(bar.close));
  const highs = bars.map((bar) => Number(bar.high));
  const lows = bars.map((bar) => Number(bar.low));
  const lookback = 22;
  const bandWindow = 20;
  const rangeWindow = 50;
  const confirmationWindow = 8;
  const oversold = 20;
  const overbought = 80;

  const vixFix = closes.map((_, index) => {
    const highestClose = recentExtreme(closes, index, lookback, "max");
    return highestClose > 0
      ? ((highestClose - lows[index]) / highestClose) * 100
      : 0;
  });
  const inverseVixFix = closes.map((_, index) => {
    const lowestClose = recentExtreme(closes, index, lookback, "min");
    return lowestClose > 0
      ? ((highs[index] - lowestClose) / lowestClose) * 100
      : 0;
  });

  function spikeSeries(values: number[]) {
    return values.map((value, index) => {
      if (index < rangeWindow - 1) return false;
      const mean = rollingAverage(values, index, bandWindow);
      const deviation = rollingStandardDeviation(values, index, bandWindow);
      const upperBand = mean + deviation * 2;
      const rangeHigh =
        recentExtreme(values, index, rangeWindow, "max") * 0.85;
      return value >= upperBand || value >= rangeHigh;
    });
  }

  const bottomSpikes = spikeSeries(vixFix);
  const topSpikes = spikeSeries(inverseVixFix);
  const rawK = closes.map((close, index) => {
    if (index < 13) return Number.NaN;
    const lowestLow = recentExtreme(lows, index, 14, "min");
    const highestHigh = recentExtreme(highs, index, 14, "max");
    return highestHigh > lowestLow
      ? ((close - lowestLow) / (highestHigh - lowestLow)) * 100
      : 50;
  });
  const stochasticK = rawK.map((_, index) =>
    rollingAverage(rawK, index, 3),
  );
  const stochasticD = stochasticK.map((_, index) =>
    rollingAverage(stochasticK, index, 3),
  );

  const indicators: VixFixIndicatorPoint[] = bars.map((bar, index) => ({
    date: bar.day,
    vixFix: vixFix[index],
    inverseVixFix: inverseVixFix[index],
    stochasticK: stochasticK[index],
    stochasticD: stochasticD[index],
    bottomSpike: bottomSpikes[index],
    topSpike: topSpikes[index],
  }));
  const events = new Map<string, VixFixSignalDetail>();
  let usedBottomSpike = -1;
  let usedTopSpike = -1;

  bars.forEach((bar, index) => {
    if (index < rangeWindow + 5) return;
    const k = stochasticK[index];
    const d = stochasticD[index];
    const previousK = stochasticK[index - 1];
    const previousD = stochasticD[index - 1];
    if (![k, d, previousK, previousD].every(Number.isFinite)) return;

    const windowStart = Math.max(0, index - confirmationWindow + 1);
    let latestBottomSpike = -1;
    let latestTopSpike = -1;
    for (let cursor = windowStart; cursor <= index; cursor += 1) {
      if (bottomSpikes[cursor]) latestBottomSpike = cursor;
      if (topSpikes[cursor]) latestTopSpike = cursor;
    }
    const recentStochasticLow = recentExtreme(
      stochasticK,
      index,
      confirmationWindow,
      "min",
    );
    const recentStochasticHigh = recentExtreme(
      stochasticK,
      index,
      confirmationWindow,
      "max",
    );
    const bullishCross = previousK <= previousD && k > d;
    const bearishCross = previousK >= previousD && k < d;
    const buyConfirmed =
      latestBottomSpike > usedBottomSpike &&
      recentStochasticLow <= oversold &&
      bullishCross;
    const sellConfirmed =
      latestTopSpike > usedTopSpike &&
      recentStochasticHigh >= overbought &&
      bearishCross;

    if (buyConfirmed && !sellConfirmed) {
      usedBottomSpike = latestBottomSpike;
      const stop = recentExtreme(lows, index, 10, "min");
      events.set(bar.day, {
        signal: "add",
        signalLabel: "买点",
        reason: `底部VIX Fix峰值已出现，随机指标由超卖区金叉（K ${k.toFixed(1)} / D ${d.toFixed(1)}）`,
        vixFix: vixFix[index],
        inverseVixFix: inverseVixFix[index],
        stochasticK: k,
        stochasticD: d,
        referenceStop: stop,
        sourceRule: "视频明确规则：底部VIX Fix绿色柱 + 随机指标超卖金叉",
      });
    } else if (sellConfirmed) {
      usedTopSpike = latestTopSpike;
      const stop = recentExtreme(highs, index, 10, "max");
      events.set(bar.day, {
        signal: "empty",
        signalLabel: "卖点",
        reason: `顶部反向VIX Fix峰值已出现，随机指标由超买区死叉（K ${k.toFixed(1)} / D ${d.toFixed(1)}）`,
        vixFix: vixFix[index],
        inverseVixFix: inverseVixFix[index],
        stochasticK: k,
        stochasticD: d,
        referenceStop: stop,
        sourceRule: "视频明确规则：顶部反向VIX Fix信号 + 随机指标超买死叉",
      });
    }
  });

  return {
    events,
    indicators,
    parameters: {
      vixFix: "22 / 20 / 2 / 50 / 0.85",
      stochastic: "14 / 3 / 3，超卖20，超买80",
      confirmationWindow,
      execution: "收盘确认，下一交易日执行",
    },
  };
}
