import type { LiveSecurityRadarPayload } from "@shared/api.interface";

import {
  buildVixFixSignals,
  type PriceBar,
} from "./vix-fix-signals";

const NextResponse = {
  json<T extends LiveSecurityRadarPayload>(payload: T, _init?: unknown): T {
    return payload;
  },
};

type Kline = {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  intraday?: boolean;
};

type Quote = {
  name: string;
  open: number;
  previousClose: number;
  price: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  date: string;
  time: string;
};

type Member = {
  symbol: string;
  code: string;
  name: string;
  role: string;
};

type Series = {
  member: Member;
  klines: Kline[];
  quote: Quote;
};

type Component = {
  key: string;
  label: string;
  score: number;
  current: string;
  meaning: string;
};

type TierSignal = "add" | "full" | "reduce" | "empty";

type RadarTrendPoint = {
  date: string;
  score: number;
  price: number;
  intraday?: boolean;
  return20?: number;
  signal?: TierSignal;
  signalLabel?: string;
  signalReason?: string;
  signalStreak?: number;
  level?: 0 | 1 | 2;
  v12Sell?: boolean;
  v12SellLabel?: string;
  v12SellReason?: string;
  sellResonance?: boolean;
};

const PCB_MEMBERS: Member[] = [
  { symbol: "sz002463", code: "002463", name: "沪电股份", role: "高速通信PCB" },
  { symbol: "sz300476", code: "300476", name: "胜宏科技", role: "高阶HDI/AI服务器PCB" },
  { symbol: "sz002916", code: "002916", name: "深南电路", role: "PCB/封装基板" },
  { symbol: "sz002938", code: "002938", name: "鹏鼎控股", role: "消费电子PCB" },
  { symbol: "sz002384", code: "002384", name: "东山精密", role: "柔性线路板" },
  { symbol: "sh600183", code: "600183", name: "生益科技", role: "覆铜板" },
  { symbol: "sh603228", code: "603228", name: "景旺电子", role: "多品类PCB" },
  { symbol: "sz002436", code: "002436", name: "兴森科技", role: "样板/封装基板" },
  { symbol: "sz002815", code: "002815", name: "崇达技术", role: "中高端PCB" },
  { symbol: "sh603920", code: "603920", name: "世运电路", role: "汽车PCB" },
  { symbol: "sz002913", code: "002913", name: "奥士康", role: "多层PCB" },
  { symbol: "sz300814", code: "300814", name: "中富电路", role: "通信/工控PCB" },
  { symbol: "sz300903", code: "300903", name: "科翔股份", role: "多层板/HDI" },
  { symbol: "sz002579", code: "002579", name: "中京电子", role: "刚柔结合板" },
  { symbol: "sz002636", code: "002636", name: "金安国纪", role: "覆铜板" },
];

const EXTRA_STOCKS: Member[] = [
  {
    symbol: "sz300274",
    code: "300274",
    name: "阳光电源",
    role: "光伏逆变器/储能",
  },
];
const ALL_STOCKS = [...PCB_MEMBERS, ...EXTRA_STOCKS];
const PCB_SYMBOLS = new Set(PCB_MEMBERS.map((member) => member.symbol));
const TARGETS = new Set(["sz002463", "sz300476", "sz300274"]);
const LEADERS = new Set([
  "sz002463",
  "sz300476",
  "sz002916",
  "sz002938",
  "sz002384",
]);
const HEADERS = {
  accept: "*/*",
  referer: "https://finance.sina.com.cn/",
  "user-agent": "Mozilla/5.0 AFGI-Security-Radar/1.0",
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));
const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
const percent = (value: number) =>
  `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
}

function annualizedVolatility(closes: number[], end: number, window = 20) {
  const start = Math.max(1, end - window + 1);
  const returns: number[] = [];
  for (let index = start; index <= end; index += 1) {
    if (closes[index - 1] > 0) {
      returns.push(closes[index] / closes[index - 1] - 1);
    }
  }
  return standardDeviation(returns) * Math.sqrt(252);
}

function meanAt(values: number[], end: number, window: number) {
  return average(values.slice(Math.max(0, end - window + 1), end + 1));
}

function returnAt(values: number[], end: number, window: number) {
  const start = Math.max(0, end - window);
  return values[start] > 0 ? values[end] / values[start] - 1 : 0;
}

function parseKlines(text: string) {
  const start = text.indexOf("([");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) throw new Error("日线数据格式异常");
  return JSON.parse(text.slice(start + 1, end)) as Kline[];
}

function parseQuotes(text: string) {
  const quotes = new Map<string, Quote>();
  text
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const symbol = line.match(/hq_str_([a-z0-9]+)=/)?.[1];
      const body = line.match(/"([^"]*)"/)?.[1];
      if (!symbol || !body) return;
      const fields = body.split(",");
      quotes.set(symbol, {
        name: fields[0] || symbol,
        open: Number(fields[1]) || 0,
        previousClose: Number(fields[2]) || 0,
        price: Number(fields[3]) || Number(fields[2]) || 0,
        high: Number(fields[4]) || 0,
        low: Number(fields[5]) || 0,
        volume: Number(fields[8]) || 0,
        amount: Number(fields[9]) || 0,
        date: fields[30] || "",
        time: fields[31] || "",
      });
    });
  return quotes;
}

function appendIntradayBar(klines: Kline[], quote: Quote) {
  const latest = klines.at(-1);
  if (
    !latest ||
    !quote.date ||
    quote.date <= latest.day ||
    quote.price <= 0 ||
    quote.volume <= 0
  ) {
    return klines;
  }
  const open = quote.open || quote.previousClose || quote.price;
  const high = quote.high || Math.max(open, quote.price);
  const low = quote.low || Math.min(open, quote.price);
  return [
    ...klines,
    {
      day: quote.date,
      open: String(open),
      high: String(high),
      low: String(low),
      close: String(quote.price),
      volume: String(quote.volume),
      intraday: true,
    },
  ];
}

function zone(score: number) {
  if (score < 20) return "极弱 / 情绪冰点";
  if (score < 40) return "偏弱 / 防守";
  if (score < 60) return "中性 / 分歧";
  if (score < 80) return "偏强 / 活跃";
  return "过热 / 高波动";
}

function posture(score: number, return20: number, volatility: number) {
  if (score >= 80) {
    return {
      label: "强势过热",
      detail: "趋势很强但追高风险上升，优先等待回踩确认，不把高分直接等同于买点。",
    };
  }
  if (score >= 65) {
    return {
      label: "强势跟随",
      detail: "趋势与扩散多数同向，可继续观察强势是否由成交和板块环境确认。",
    };
  }
  if (score >= 50) {
    return {
      label: "中性观察",
      detail: "多空信息混合，适合等待趋势、相对强弱和量价同时改善。",
    };
  }
  if (score >= 35) {
    return {
      label: "偏弱防守",
      detail: "结构尚未形成右侧确认，反弹更适合视为观察窗口。",
    };
  }
  return {
    label: return20 < -0.12 || volatility > 0.55 ? "弱势高风险" : "弱势等待",
    detail: "趋势和风险偏好均偏弱，先控制回撤并等待结构修复。",
  };
}

function attachStatefulSignals(points: RadarTrendPoint[]) {
  const trend = points.map((point) => ({ ...point }));
  const prices = trend.map((item) => item.price);
  let level: 0 | 1 | 2 = 0;
  let recoveryDays = 0;
  const labels: Record<TierSignal, string> = {
    add: "补仓点",
    full: "全仓点",
    reduce: "减仓点",
    empty: "空仓点",
  };

  trend.forEach((point, index) => {
    if (index < 60) return;
    if (point.intraday) {
      point.level = level;
      return;
    }
    const threeDayChange =
      point.score - trend[Math.max(0, index - 3)].score;
    const oneDayChange =
      point.score - trend[Math.max(0, index - 1)].score;
    const ma20 = meanAt(prices, index, 20);
    const ma60 = meanAt(prices, index, 60);
    const addCandidate =
      point.score >= 48 &&
      threeDayChange >= 5 &&
      point.price >= ma20;
    const fullCandidate =
      point.score >= 62 &&
      threeDayChange >= 2 &&
      point.price >= ma20;
    const reduceCandidate =
      point.score < 52 ||
      threeDayChange <= -4 ||
      oneDayChange <= -5 ||
      point.price < ma20 * 0.99;
    const emptyCandidate =
      point.score < 28 ||
      threeDayChange <= -14 ||
      oneDayChange <= -15 ||
      point.price < ma60 * 0.94;

    let signal: TierSignal | undefined;
    if (level === 0) {
      recoveryDays = addCandidate ? recoveryDays + 1 : 0;
      if (recoveryDays >= 2) {
        level = 1;
        recoveryDays = 0;
        signal = "add";
      }
    } else if (emptyCandidate) {
      level = 0;
      recoveryDays = 0;
      signal = "empty";
    } else if (level === 2 && reduceCandidate) {
      level = 1;
      recoveryDays = 0;
      signal = "reduce";
    } else if (level === 1) {
      recoveryDays = fullCandidate ? recoveryDays + 1 : 0;
      if (recoveryDays >= 2) {
        level = 2;
        recoveryDays = 0;
        signal = "full";
      }
    }

    point.level = level;
    if (signal) {
      point.signal = signal;
      point.signalLabel = labels[signal];
    }
  });

  const latest = trend.at(-1)!;
  const latestIndex = trend.length - 1;
  const threeDayChange =
    latest.score - trend[Math.max(0, latestIndex - 3)].score;
  const price20 = meanAt(
    trend.map((item) => item.price),
    latestIndex,
    20,
  );
  const lastSignal = [...trend].reverse().find((point) => point.signal)?.signal;
  const positionSignal =
    level === 0
      ? {
          code: "empty",
          label: "空仓 / 明确防守",
          action: "模型风险暴露降至最低档",
          detail: `情绪${latest.score.toFixed(1)}分，3日变化${threeDayChange >= 0 ? "+" : ""}${threeDayChange.toFixed(1)}分；价格${latest.price >= price20 ? "仍在" : "已低于"}20日均线。`,
          nextTrigger: "情绪转升且价格重新站上20日均线后，先出现补仓点。",
          level,
        }
      : level === 1
        ? {
            code: lastSignal === "reduce" ? "reduce" : "add",
            label:
              lastSignal === "reduce"
                ? "减仓 / 风险升温"
                : "补仓 / 初步修复",
            action:
              lastSignal === "reduce"
                ? "从最高风险暴露降至部分风险暴露"
                : "从最低风险暴露恢复至部分风险暴露",
            detail: `情绪${latest.score.toFixed(1)}分，3日变化${threeDayChange >= 0 ? "+" : ""}${threeDayChange.toFixed(1)}分；尚未完成强趋势确认。`,
            nextTrigger:
              "连续2次满足强趋势条件升级为全仓；情绪或价格明确破坏则空仓。",
            level,
          }
        : {
            code: "full",
            label: "全仓 / 趋势确认",
            action: "模型处于最高风险暴露档",
            detail: `情绪${latest.score.toFixed(1)}分，3日变化${threeDayChange >= 0 ? "+" : ""}${threeDayChange.toFixed(1)}分；趋势已连续确认。`,
            nextTrigger: "首次转弱先减仓；情绪或价格明确破坏则直接空仓。",
            level,
          };

  return { trend, positionSignal };
}

function attachV12SellSignals(points: RadarTrendPoint[]) {
  const trend = points.map((point) => ({ ...point }));
  const prices = trend.map((point) => point.price);
  const momentum = trend.map((point, index) => {
    const close20 = prices[Math.max(0, index - 20)] || point.price;
    const ma125 = meanAt(prices, index, 125);
    const return20 = point.price / Math.max(0.0001, close20) - 1;
    const deviation125 = point.price / Math.max(0.0001, ma125) - 1;
    return clamp(50 + return20 * 420 + deviation125 * 180);
  });
  let invested = false;
  let entryConfirmationDays = 0;
  let holdingDays = 0;

  trend.forEach((point, index) => {
    if (index < 125 || point.intraday) return;
    const threeDayChange =
      point.score - trend[Math.max(0, index - 3)].score;
    const oneDayChange =
      point.score - trend[Math.max(0, index - 1)].score;
    const entryCandidate =
      point.score >= 55 &&
      momentum[index] >= 50 &&
      threeDayChange >= 3;
    const exitCandidate =
      momentum[index] < 40 ||
      threeDayChange <= -6 ||
      oneDayChange <= -10;

    if (!invested) {
      holdingDays = 0;
      entryConfirmationDays = entryCandidate
        ? entryConfirmationDays + 1
        : 0;
      if (entryConfirmationDays >= 2) {
        invested = true;
        entryConfirmationDays = 0;
      }
      return;
    }

    holdingDays += 1;
    if (exitCandidate && holdingDays >= 5) {
      invested = false;
      point.v12Sell = true;
      point.v12SellLabel = "V12风险提醒";
      point.v12SellReason = `V12二次确认：3日情绪变化${threeDayChange.toFixed(1)}分，价格动量${momentum[index].toFixed(1)}分`;
    }
  });

  return trend;
}

function mergeV12SellOverlay(
  primary: RadarTrendPoint[],
  v12Trend: RadarTrendPoint[],
) {
  const v12ByDate = new Map(v12Trend.map((point) => [point.date, point]));
  return primary.map((point) => {
    const v12Point = v12ByDate.get(point.date);
    if (!v12Point?.v12Sell) return point;
    const sellResonance = point.signal === "empty";
    return {
      ...point,
      v12Sell: true,
      v12SellLabel: sellResonance ? "V12同步确认" : "V12风险提醒",
      v12SellReason: v12Point.v12SellReason,
      sellResonance,
    };
  });
}

function evaluateV12SellAccuracy(
  points: RadarTrendPoint[],
  horizonDays: number,
  drawdownThreshold: number,
) {
  return evaluateSignalAccuracy(
    points.map((point) => ({
      ...point,
      signal: point.v12Sell ? ("empty" as const) : undefined,
    })),
    horizonDays,
    drawdownThreshold,
  );
}

function attachVideoSignals(
  points: RadarTrendPoint[],
  bars: PriceBar[],
  v13Trend: RadarTrendPoint[],
) {
  const trend = points.map((point) => ({ ...point }));
  const candidateTrend = points.map((point) => ({ ...point }));
  const model = buildVixFixSignals(bars);
  const labels: Record<"add" | "empty", string> = {
    add: "买点",
    empty: "卖点",
  };
  trend.forEach((point) => {
    if (point.intraday) return;
    const signal = model.events.get(point.date);
    if (!signal || signal.signal !== "add") return;
    point.signal = signal.signal;
    point.signalLabel = labels[signal.signal];
    point.signalReason = `${signal.reason}；参考${
      signal.signal === "add" ? "止损" : "保护"
    }位${signal.referenceStop.toFixed(2)}`;
    point.level = signal.signal === "add" ? 1 : 0;
  });
  candidateTrend.forEach((point) => {
    if (point.intraday) return;
    const signal = model.events.get(point.date);
    if (!signal) return;
    point.signal = signal.signal;
    point.signalLabel = signal.signalLabel;
    point.signalReason = signal.reason;
    point.level = signal.signal === "add" ? 1 : 0;
  });
  const v13ByDate = new Map(v13Trend.map((point) => [point.date, point]));
  trend.forEach((point, index) => {
    if (point.intraday) return;
    const v13Point = v13ByDate.get(point.date);
    if (v13Point?.signal !== "empty") return;
    point.signal = "empty";
    point.signalLabel = "卖点";
    point.signalReason = `第13版风险过滤确认：${v13Point.signalLabel}；参考保护位${Math.max(
      ...trend
        .slice(Math.max(0, index - 9), index + 1)
        .map((item) => item.price),
    ).toFixed(2)}`;
    point.level = 0;
  });

  const latest = trend.at(-1)!;
  const latestIndicator = model.indicators.at(-1)!;
  const priorSignal = [...trend].reverse().find((point) => point.signal);
  const positionSignal = latest.signal
    ? {
        code: latest.signal,
        label: `${latest.signalLabel} / ${
          latest.signal === "add" ? "底部双确认" : "风险过滤确认"
        }`,
        action:
          latest.signal === "add"
            ? "今日收盘确认买点，下一交易日按计划建立仓位"
            : "今日收盘确认卖点，下一交易日按计划降低仓位",
        detail: latest.signalReason!,
        nextTrigger:
          latest.signal === "add"
            ? "风险过滤器成立时出现卖点；新的底部峰值可再次形成独立买点。"
            : "新的底部VIX Fix峰值与随机指标超卖金叉同时成立时出现买点。",
        level: (latest.signal === "add" ? 1 : 0) as 0 | 1,
      }
    : {
        code: "waiting" as const,
        label: "等待 / 今日无新买卖点",
        action: "买点双确认未成立，空仓级风险卖点也未触发",
        detail: `VIX Fix ${latestIndicator.vixFix.toFixed(2)}，反向值${latestIndicator.inverseVixFix.toFixed(2)}，随机指标K ${latestIndicator.stochasticK.toFixed(1)} / D ${latestIndicator.stochasticD.toFixed(1)}。${
          priorSignal
            ? `最近一次为${priorSignal.date.slice(5)}的${priorSignal.signalLabel}。`
            : ""
        }`,
        nextTrigger: "底部峰值后超卖金叉触发买点；第13版风险过滤器触发卖点。",
        level: 0 as const,
      };

  return { trend, candidateTrend, positionSignal, model };
}

function evaluateSignalAccuracy(
  points: RadarTrendPoint[],
  horizonDays = 10,
  drawdownThreshold = 0.03,
) {
  const buyReturns: number[] = [];
  const riskReturns: number[] = [];
  const riskDrawdowns: number[] = [];
  points.forEach((point, index) => {
    if (!point.signal || index + horizonDays >= points.length) return;
    const future = points.slice(index + 1, index + horizonDays + 1);
    const forwardReturn =
      future.at(-1)!.price / Math.max(0.0001, point.price) - 1;
    if (point.signal === "add" || point.signal === "full") {
      buyReturns.push(forwardReturn);
    } else {
      riskReturns.push(forwardReturn);
      riskDrawdowns.push(
        Math.min(
          ...future.map(
            (item) => item.price / Math.max(0.0001, point.price) - 1,
          ),
        ),
      );
    }
  });
  const summarize = (values: number[], hit: (value: number) => boolean) => ({
    signals: values.length,
    hitRate: values.length
      ? (values.filter(hit).length / values.length) * 100
      : 0,
    averageForwardReturn: values.length ? average(values) * 100 : 0,
  });
  return {
    horizonDays,
    buy: summarize(buyReturns, (value) => value > 0),
    risk: {
      ...summarize(riskReturns, (value) => value < 0),
      drawdownCaptureRate: riskDrawdowns.length
        ? (riskDrawdowns.filter((value) => value <= -drawdownThreshold).length /
            riskDrawdowns.length) *
          100
        : 0,
      drawdownThreshold: drawdownThreshold * 100,
    },
  };
}

function klineUrl(symbol: string) {
  return (
    `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_${symbol}=/` +
    `CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=300`
  );
}

async function fetchText(url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        cache: "no-store",
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`行情源返回${response.status}`);
      }
      return text;
    } catch (reason) {
      lastError = reason;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("行情连接失败");
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  operation: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, limit), items.length) },
      () => worker(),
    ),
  );
  return results;
}

function seriesByDate(series: Series[]) {
  return series.map((item) => ({
    ...item,
    dates: new Map(item.klines.map((bar, index) => [bar.day, index])),
    closes: item.klines.map((bar) => Number(bar.close)),
    opens: item.klines.map((bar) => Number(bar.open)),
    highs: item.klines.map((bar) => Number(bar.high)),
    lows: item.klines.map((bar) => Number(bar.low)),
    volumes: item.klines.map((bar) => Number(bar.volume)),
  }));
}

function buildSector(series: Series[], benchmark: Kline[]) {
  const prepared = seriesByDate(series);
  const intradayDates = new Set(
    series.flatMap((item) =>
      item.klines.filter((bar) => bar.intraday).map((bar) => bar.day),
    ),
  );
  const commonDates = benchmark
    .map((item) => item.day)
    .filter((date) => prepared.filter((item) => item.dates.has(date)).length >= 10);
  const benchmarkCloses = benchmark.map((item) => Number(item.close));
  const benchmarkDates = new Map(
    benchmark.map((item, index) => [item.day, index]),
  );
  const synthetic: number[] = [];
  const syntheticOpen: number[] = [];
  const syntheticHigh: number[] = [];
  const syntheticLow: number[] = [];

  commonDates.forEach((date, dateIndex) => {
    if (dateIndex === 0) {
      synthetic.push(100);
      syntheticOpen.push(100);
      syntheticHigh.push(100);
      syntheticLow.push(100);
      return;
    }
    const dailyBars = prepared.flatMap((item) => {
      const index = item.dates.get(date);
      const previousDate = commonDates[dateIndex - 1];
      const previousIndex = item.dates.get(previousDate);
      if (
        index === undefined ||
        previousIndex === undefined ||
        item.closes[previousIndex] <= 0
      ) {
        return [];
      }
      const previousClose = item.closes[previousIndex];
      return [
        {
          close: item.closes[index] / previousClose - 1,
          open: item.opens[index] / previousClose - 1,
          high: item.highs[index] / previousClose - 1,
          low: item.lows[index] / previousClose - 1,
        },
      ];
    });
    const previousSynthetic = synthetic[dateIndex - 1];
    synthetic.push(
      previousSynthetic * (1 + average(dailyBars.map((bar) => bar.close))),
    );
    syntheticOpen.push(
      previousSynthetic * (1 + average(dailyBars.map((bar) => bar.open))),
    );
    syntheticHigh.push(
      previousSynthetic * (1 + average(dailyBars.map((bar) => bar.high))),
    );
    syntheticLow.push(
      previousSynthetic * (1 + average(dailyBars.map((bar) => bar.low))),
    );
  });
  const syntheticBars: Array<PriceBar & { intraday?: boolean }> = commonDates.map((day, index) => ({
    day,
    open: syntheticOpen[index],
    high: syntheticHigh[index],
    low: syntheticLow[index],
    close: synthetic[index],
    intraday: intradayDates.has(day),
  }));

  function calculate(end: number) {
    const date = commonDates[end];
    const dailyReturns: number[] = [];
    const volumeRatios: number[] = [];
    let leadersAbove20 = 0;
    let leaderCount = 0;

    prepared.forEach((item) => {
      const index = item.dates.get(date);
      if (index === undefined || index < 1) return;
      dailyReturns.push(item.closes[index] / item.closes[index - 1] - 1);
      const volume20 = meanAt(item.volumes, index - 1, 20);
      if (volume20 > 0) volumeRatios.push(item.volumes[index] / volume20);
      if (LEADERS.has(item.member.symbol)) {
        leaderCount += 1;
        if (item.closes[index] >= meanAt(item.closes, index, 20)) {
          leadersAbove20 += 1;
        }
      }
    });

    const sectorReturn20 = returnAt(synthetic, end, 20);
    const sectorMa60 = meanAt(synthetic, end, 60);
    const sectorDeviation60 = synthetic[end] / sectorMa60 - 1;
    const benchmarkIndex = benchmarkDates.get(date) ?? benchmark.length - 1;
    const benchmarkReturn20 = returnAt(
      benchmarkCloses,
      benchmarkIndex,
      20,
    );
    const up = dailyReturns.filter((value) => value > 0).length;
    const strong = dailyReturns.filter((value) => value >= 0.03).length;
    const weak = dailyReturns.filter((value) => value <= -0.03).length;
    const volatility = annualizedVolatility(synthetic, end);
    const volumeRatio = average(volumeRatios) || 1;
    const components: Component[] = [
      {
        key: "trend",
        label: "板块趋势",
        score: clamp(50 + sectorReturn20 * 260 + sectorDeviation60 * 220),
        current: `20日${percent(sectorReturn20)}，相对60日均线${percent(sectorDeviation60)}`,
        meaning: "同时衡量中短期涨幅与中期均线位置，低分表示趋势偏弱，高分表示板块趋势向上。",
      },
      {
        key: "breadth",
        label: "上涨宽度",
        score: clamp((up / Math.max(1, dailyReturns.length)) * 100),
        current: `${up}/${dailyReturns.length}只样本上涨`,
        meaning: "判断上涨是否扩散到多数样本。少数龙头上涨、宽度偏低时，板块行情并不扎实。",
      },
      {
        key: "strength",
        label: "强弱分布",
        score: clamp(50 + ((strong - weak) / Math.max(1, dailyReturns.length)) * 100),
        current: `涨幅≥3%有${strong}只，跌幅≤-3%有${weak}只`,
        meaning: "比较强势股和弱势股的数量差，用于识别赚钱效应或亏钱效应是否扩散。",
      },
      {
        key: "relative",
        label: "相对大盘",
        score: clamp(50 + (sectorReturn20 - benchmarkReturn20) * 360),
        current: `20日跑赢沪深300 ${percent(sectorReturn20 - benchmarkReturn20)}`,
        meaning: "板块相对沪深300的20日超额收益。高分表示资金偏好更集中于PCB方向。",
      },
      {
        key: "liquidity",
        label: "成交活跃",
        score: clamp(50 + (volumeRatio - 1) * 55),
        current: `样本量比20日均值${volumeRatio.toFixed(2)}倍`,
        meaning: "观察成交量是否比近期常态更活跃。放量需要与价格方向一起解读，单独放量不代表利好。",
      },
      {
        key: "volatility",
        label: "波动健康",
        score: clamp(100 - ((volatility - 0.18) / 0.48) * 100),
        current: `20日年化波动率${(volatility * 100).toFixed(1)}%`,
        meaning: "波动越剧烈得分越低，代表持有体验和回撤风险更高；它不是趋势方向指标。",
      },
      {
        key: "leadership",
        label: "龙头协同",
        score: clamp((leadersAbove20 / Math.max(1, leaderCount)) * 100),
        current: `${leadersAbove20}/${leaderCount}只核心龙头站上20日均线`,
        meaning: "观察沪电、胜宏、深南、鹏鼎、东山是否同步转强，避免只看单一龙头造成误判。",
      },
    ];
    const weights: Record<string, number> = {
      trend: 0.25,
      breadth: 0.2,
      strength: 0.15,
      relative: 0.15,
      liquidity: 0.1,
      volatility: 0.1,
      leadership: 0.05,
    };
    const score = components.reduce(
      (sum, component) => sum + component.score * weights[component.key],
      0,
    );
    return {
      date,
      price: synthetic[end],
      score,
      return20: sectorReturn20,
      volatility,
      components,
      benchmarkReturn20,
    };
  }

  const latest = calculate(commonDates.length - 1);
  const rawTrend = commonDates
    .slice(-300)
    .map((date) => {
      const point = calculate(commonDates.indexOf(date));
      return {
        date,
        score: point.score,
        price: point.price,
        return20: point.return20,
        intraday: intradayDates.has(date),
      };
    });
  const stateful = attachStatefulSignals(rawTrend);
  const v12Trend = attachV12SellSignals(rawTrend);
  const video = attachVideoSignals(
    rawTrend,
    syntheticBars.slice(-300),
    stateful.trend,
  );
  const trend = mergeV12SellOverlay(video.trend, v12Trend).slice(-180);
  const statefulTrend = stateful.trend.slice(-180);
  const todayReturns = prepared.flatMap((item) => {
    const quote = item.quote;
    return quote.previousClose > 0
      ? [quote.price / quote.previousClose - 1]
      : [];
  });
  const todayChange = average(todayReturns);
  const state = posture(latest.score, latest.return20, latest.volatility);

  return {
    id: "pcb",
    kind: "sector",
    name: "PCB核心样本",
    code: "PCB · 15只等权",
    role: "行业情绪与扩散",
    score: latest.score,
    zone: zone(latest.score),
    state,
    price: null,
    todayChange,
    return20: latest.return20,
    volatility: latest.volatility,
    components: latest.components,
    trend,
    positionSignal: video.positionSignal,
    signalValidation: {
      mode: "V15视频买点＋V13强卖点＋V12风险对照",
      independent: evaluateSignalAccuracy(trend, 10, 0.03),
      stateful: evaluateSignalAccuracy(statefulTrend, 10, 0.03),
      v12Sell: evaluateV12SellAccuracy(v12Trend.slice(-180), 10, 0.03),
      videoOnly: evaluateSignalAccuracy(video.candidateTrend.slice(-180), 10, 0.03),
      labels: {
        independent: "V15混合版",
        stateful: "第13版递进四档",
        v12Sell: "V12二次确认卖点",
      },
      parameters: video.model.parameters,
    },
    snapshot: {
      label: "样本涨跌",
      value: `${todayReturns.filter((value) => value > 0).length}涨 / ${
        todayReturns.filter((value) => value < 0).length
      }跌`,
    },
  };
}

function buildStock(
  item: Series,
  sector: ReturnType<typeof buildSector> | null,
  benchmark: Kline[],
) {
  const closes = item.klines.map((bar) => Number(bar.close));
  const volumes = item.klines.map((bar) => Number(bar.volume));
  const benchmarkCloses = benchmark.map((bar) => Number(bar.close));
  const benchmarkDates = new Map(
    benchmark.map((bar, index) => [bar.day, index]),
  );
  const sectorByDate = new Map(
    (sector?.trend ?? []).map((point) => [point.date, point]),
  );

  function calculate(end: number) {
    const close = closes[end];
    const return20 = returnAt(closes, end, 20);
    const ma60 = meanAt(closes, end, 60);
    const deviation60 = close / ma60 - 1;
    const stockVolatility = annualizedVolatility(closes, end);
    const benchmarkIndex =
      benchmarkDates.get(item.klines[end].day) ?? benchmarkCloses.length - 1;
    const benchmarkReturn20 = returnAt(benchmarkCloses, benchmarkIndex, 20);
    const volume20 = meanAt(volumes, Math.max(0, end - 1), 20);
    const volumeRatio = volume20 > 0 ? volumes[end] / volume20 : 1;
    const dailyReturn = end > 0 ? close / closes[end - 1] - 1 : 0;
    const high60 = Math.max(...closes.slice(Math.max(0, end - 59), end + 1));
    const low60 = Math.min(...closes.slice(Math.max(0, end - 59), end + 1));
    const rangePosition =
      high60 > low60 ? (close - low60) / (high60 - low60) : 0.5;
    const sectorPoint = sectorByDate.get(item.klines[end].day);
    const comparisonReturn20 =
      sectorPoint?.return20 ?? sector?.return20 ?? benchmarkReturn20;
    const environmentScore = sector
      ? sectorPoint?.score ?? sector.score
      : clamp(50 + return20 * 180 + deviation60 * 260);
    const components: Component[] = [
      {
        key: "trend",
        label: "个股趋势",
        score: clamp(50 + return20 * 230 + deviation60 * 230),
        current: `20日${percent(return20)}，相对60日均线${percent(deviation60)}`,
        meaning: "衡量个股中短期涨幅和中期均线位置，是方向指标，不代表当前位置便宜。",
      },
      {
        key: "relative",
        label: sector ? "相对PCB" : "相对大盘",
        score: clamp(50 + (return20 - comparisonReturn20) * 340),
        current: `20日相对${sector ? "PCB样本" : "沪深300"}${percent(return20 - comparisonReturn20)}`,
        meaning: sector
          ? "高分表示个股跑赢PCB核心样本；低分表示即使板块上涨，该股也可能处于掉队状态。"
          : "高分表示个股跑赢沪深300，低分表示个股阶段性弱于整体市场。",
      },
      {
        key: "volume",
        label: "量价确认",
        score: clamp(
          50 +
            (volumeRatio - 1) * (dailyReturn >= 0 ? 38 : -28) +
            dailyReturn * 500,
        ),
        current: `当日${percent(dailyReturn)}，量比20日${volumeRatio.toFixed(2)}倍`,
        meaning: "上涨放量加分、下跌放量减分。缩量上涨或放量下跌时，不把价格变化视为充分确认。",
      },
      {
        key: "position",
        label: "突破位置",
        score: clamp(rangePosition * 100),
        current: `位于近60日价格区间的${(rangePosition * 100).toFixed(0)}%位置`,
        meaning: "接近高位表示趋势强，但也可能更拥挤；需与波动健康和量价确认一起判断。",
      },
      {
        key: "volatility",
        label: "波动健康",
        score: clamp(100 - ((stockVolatility - 0.25) / 0.65) * 100),
        current: `20日年化波动率${(stockVolatility * 100).toFixed(1)}%`,
        meaning: "波动越大得分越低，用于提醒回撤和仓位风险；低分不等于股价必跌。",
      },
      {
        key: "sector",
        label: sector ? "板块环境" : "中期结构",
        score: environmentScore,
        current: sector
          ? `PCB样本情绪${environmentScore.toFixed(1)}分`
          : `相对60日均线${percent(deviation60)}`,
        meaning: sector
          ? "个股更容易在板块扩散向上时获得持续性。板块偏弱而个股独强时，需要警惕持续性。"
          : "未混用PCB板块数据，改用个股20日收益与60日均线位置判断中期结构。",
      },
      {
        key: "market",
        label: "大盘环境",
        score: clamp(50 + benchmarkReturn20 * 330),
        current: `沪深300近20日${percent(benchmarkReturn20)}`,
        meaning: "用沪深300趋势代表系统性市场环境，避免只看个股而忽略整体风险偏好。",
      },
    ];
    const weights: Record<string, number> = {
      trend: 0.25,
      relative: 0.2,
      volume: 0.15,
      position: 0.1,
      volatility: 0.1,
      sector: 0.15,
      market: 0.05,
    };
    const score = components.reduce(
      (sum, component) => sum + component.score * weights[component.key],
      0,
    );
    return {
      score,
      return20,
      volatility: stockVolatility,
      components,
    };
  }

  const latest = calculate(closes.length - 1);
  const rawTrend = item.klines.slice(-300).map((bar, localIndex) => {
    const end =
      item.klines.length - Math.min(300, item.klines.length) + localIndex;
    const point = calculate(end);
    return {
      date: bar.day,
      score: point.score,
      price: closes[end],
      intraday: bar.intraday,
    };
  });
  const stateful = attachStatefulSignals(rawTrend);
  const v12Trend = attachV12SellSignals(rawTrend);
  const video = attachVideoSignals(
    rawTrend,
    item.klines.slice(-300),
    stateful.trend,
  );
  const trend = mergeV12SellOverlay(video.trend, v12Trend).slice(-180);
  const statefulTrend = stateful.trend.slice(-180);
  const price = item.quote.price || closes.at(-1) || 0;
  const todayChange =
    item.quote.previousClose > 0 ? price / item.quote.previousClose - 1 : 0;
  const state = posture(latest.score, latest.return20, latest.volatility);
  return {
    id: item.member.symbol,
    kind: "stock",
    name: item.member.name,
    code: item.member.code,
    role: item.member.role,
    score: latest.score,
    zone: zone(latest.score),
    state,
    price,
    todayChange,
    return20: latest.return20,
    volatility: latest.volatility,
    components: latest.components,
    trend,
    positionSignal: video.positionSignal,
    signalValidation: {
      mode: "V15视频买点＋V13强卖点＋V12风险对照",
      independent: evaluateSignalAccuracy(trend, 10, 0.05),
      stateful: evaluateSignalAccuracy(statefulTrend, 10, 0.05),
      v12Sell: evaluateV12SellAccuracy(v12Trend.slice(-180), 10, 0.05),
      videoOnly: evaluateSignalAccuracy(video.candidateTrend.slice(-180), 10, 0.05),
      labels: {
        independent: "V15混合版",
        stateful: "第13版递进四档",
        v12Sell: "V12二次确认卖点",
      },
      parameters: video.model.parameters,
    },
    snapshot: {
      label: "当日成交额",
      value: `${(item.quote.amount / 100_000_000).toFixed(1)}亿`,
    },
  };
}

function buildIndex(
  klines: Kline[],
  quote: Quote,
  benchmark: Kline[],
) {
  const closes = klines.map((bar) => Number(bar.close));
  const volumes = klines.map((bar) => Number(bar.volume));
  const benchmarkCloses = benchmark.map((bar) => Number(bar.close));
  const benchmarkDates = new Map(
    benchmark.map((bar, index) => [bar.day, index]),
  );

  function calculate(end: number) {
    const close = closes[end];
    const return5 = returnAt(closes, end, 5);
    const return20 = returnAt(closes, end, 20);
    const ma60 = meanAt(closes, end, 60);
    const deviation60 = close / ma60 - 1;
    const volatility = annualizedVolatility(closes, end);
    const volume20 = meanAt(volumes, Math.max(0, end - 1), 20);
    const volumeRatio = volume20 > 0 ? volumes[end] / volume20 : 1;
    const dailyReturn = end > 0 ? close / closes[end - 1] - 1 : 0;
    const high60 = Math.max(...closes.slice(Math.max(0, end - 59), end + 1));
    const low60 = Math.min(...closes.slice(Math.max(0, end - 59), end + 1));
    const rangePosition =
      high60 > low60 ? (close - low60) / (high60 - low60) : 0.5;
    const benchmarkIndex =
      benchmarkDates.get(klines[end].day) ?? benchmarkCloses.length - 1;
    const benchmarkReturn20 = returnAt(
      benchmarkCloses,
      benchmarkIndex,
      20,
    );
    const components: Component[] = [
      {
        key: "trend",
        label: "指数趋势",
        score: clamp(50 + return20 * 260 + deviation60 * 220),
        current: `20日${percent(return20)}，相对60日均线${percent(deviation60)}`,
        meaning: "衡量科创50中短期收益和中期均线位置，是指数方向的核心维度。",
      },
      {
        key: "momentum",
        label: "短期动量",
        score: clamp(50 + return5 * 420 + dailyReturn * 320),
        current: `5日${percent(return5)}，当日${percent(dailyReturn)}`,
        meaning: "观察最近5日与当日价格加速度，用于识别修复或转弱是否正在发生。",
      },
      {
        key: "relative",
        label: "相对大盘",
        score: clamp(50 + (return20 - benchmarkReturn20) * 360),
        current: `20日相对沪深300 ${percent(return20 - benchmarkReturn20)}`,
        meaning: "高分表示科创50跑赢沪深300，反映资金是否偏好高成长科技方向。",
      },
      {
        key: "liquidity",
        label: "成交活跃",
        score: clamp(
          50 +
            (volumeRatio - 1) * (dailyReturn >= 0 ? 42 : -32) +
            dailyReturn * 260,
        ),
        current: `成交量为20日均值${volumeRatio.toFixed(2)}倍`,
        meaning: "上涨放量加分、下跌放量减分，用于判断指数变化是否得到成交确认。",
      },
      {
        key: "position",
        label: "区间位置",
        score: clamp(rangePosition * 100),
        current: `位于近60日区间的${(rangePosition * 100).toFixed(0)}%位置`,
        meaning: "接近区间高位代表趋势更强，但需同时防范拥挤与高波动风险。",
      },
      {
        key: "volatility",
        label: "波动健康",
        score: clamp(100 - ((volatility - 0.22) / 0.58) * 100),
        current: `20日年化波动率${(volatility * 100).toFixed(1)}%`,
        meaning: "波动越大得分越低，反映科创板高弹性环境下的回撤和仓位风险。",
      },
      {
        key: "market",
        label: "大盘环境",
        score: clamp(50 + benchmarkReturn20 * 330),
        current: `沪深300近20日${percent(benchmarkReturn20)}`,
        meaning: "系统性市场环境偏弱时，科创50独立上涨的持续性通常需要更强确认。",
      },
    ];
    const weights: Record<string, number> = {
      trend: 0.25,
      momentum: 0.15,
      relative: 0.15,
      liquidity: 0.15,
      position: 0.1,
      volatility: 0.1,
      market: 0.1,
    };
    const score = components.reduce(
      (sum, component) => sum + component.score * weights[component.key],
      0,
    );
    return { score, return20, volatility, components };
  }

  const latest = calculate(closes.length - 1);
  const rawTrend = klines.slice(-300).map((bar, localIndex) => {
    const end = klines.length - Math.min(300, klines.length) + localIndex;
    const point = calculate(end);
    return {
      date: bar.day,
      score: point.score,
      price: closes[end],
      intraday: bar.intraday,
    };
  });
  const stateful = attachStatefulSignals(rawTrend);
  const v12Trend = attachV12SellSignals(rawTrend);
  const video = attachVideoSignals(
    rawTrend,
    klines.slice(-300),
    stateful.trend,
  );
  const trend = mergeV12SellOverlay(video.trend, v12Trend).slice(-180);
  const statefulTrend = stateful.trend.slice(-180);
  const price = quote.price || closes.at(-1) || 0;
  const todayChange =
    quote.previousClose > 0 ? price / quote.previousClose - 1 : 0;
  const state = posture(latest.score, latest.return20, latest.volatility);
  return {
    id: "sh000688",
    kind: "index",
    name: "科创50",
    code: "000688",
    role: "科创板核心宽基指数",
    score: latest.score,
    zone: zone(latest.score),
    state,
    price,
    todayChange,
    return20: latest.return20,
    volatility: latest.volatility,
    components: latest.components,
    trend,
    positionSignal: video.positionSignal,
    signalValidation: {
      mode: "V15视频买点＋V13强卖点＋V12风险对照",
      independent: evaluateSignalAccuracy(trend, 10, 0.02),
      stateful: evaluateSignalAccuracy(statefulTrend, 10, 0.02),
      v12Sell: evaluateV12SellAccuracy(v12Trend.slice(-180), 10, 0.02),
      videoOnly: evaluateSignalAccuracy(video.candidateTrend.slice(-180), 10, 0.02),
      labels: {
        independent: "V15混合版",
        stateful: "第13版递进四档",
        v12Sell: "V12二次确认卖点",
      },
      parameters: video.model.parameters,
    },
    snapshot: {
      label: "当日成交额",
      value: `${(quote.amount / 100_000_000).toFixed(1)}亿`,
    },
  };
}

export async function GET() {
  try {
    const historySymbols = [
      ...ALL_STOCKS.map((member) => member.symbol),
      "sh000688",
    ];
    const quoteUrl = `https://hq.sinajs.cn/list=${[
      ...historySymbols,
      "sh000300",
    ].join(",")}`;
    const [quoteText, benchmarkText] = await Promise.all([
      fetchText(quoteUrl),
      fetchText(klineUrl("sh000300")),
    ]);
    const quotes = parseQuotes(quoteText);
    const benchmarkHistory = parseKlines(benchmarkText);
    const allKlines = await mapWithLimit(
      historySymbols,
      3,
      async (symbol) => parseKlines(await fetchText(klineUrl(symbol))),
    );
    const klines = allKlines.slice(0, ALL_STOCKS.length);
    const starKlines = allKlines.at(-1)!;
    const series: Series[] = ALL_STOCKS.map((member, index) => ({
      member,
      klines: appendIntradayBar(
        klines[index],
        quotes.get(member.symbol) ??
        ({
          name: member.name,
          open: 0,
          previousClose: 0,
          price: Number(klines[index].at(-1)?.close) || 0,
          high: 0,
          low: 0,
          volume: 0,
          amount: 0,
          date: klines[index].at(-1)?.day || "",
          time: "",
        } satisfies Quote),
      ),
      quote:
        quotes.get(member.symbol) ??
        ({
          name: member.name,
          open: 0,
          previousClose: 0,
          price: Number(klines[index].at(-1)?.close) || 0,
          high: 0,
          low: 0,
          volume: 0,
          amount: 0,
          date: klines[index].at(-1)?.day || "",
          time: "",
        } satisfies Quote),
    }));
    if (
      benchmarkHistory.length < 120 ||
      starKlines.length < 120 ||
      series.some((item) => item.klines.length < 120)
    ) {
      throw new Error("指数或PCB历史样本不足");
    }

    const benchmarkQuote =
      quotes.get("sh000300") ??
      ({
        name: "沪深300",
        open: 0,
        previousClose: Number(benchmarkHistory.at(-2)?.close) || 0,
        price: Number(benchmarkHistory.at(-1)?.close) || 0,
        high: 0,
        low: 0,
        volume: Number(benchmarkHistory.at(-1)?.volume) || 0,
        amount: 0,
        date: benchmarkHistory.at(-1)?.day || "",
        time: "",
      } satisfies Quote);
    const benchmark = appendIntradayBar(benchmarkHistory, benchmarkQuote);
    const pcbSeries = series.filter((item) =>
      PCB_SYMBOLS.has(item.member.symbol),
    );
    const sector = buildSector(pcbSeries, benchmark);
    const starQuote =
      quotes.get("sh000688") ??
      ({
        name: "科创50",
        open: 0,
        previousClose: Number(starKlines.at(-2)?.close) || 0,
        price: Number(starKlines.at(-1)?.close) || 0,
        high: 0,
        low: 0,
        volume: Number(starKlines.at(-1)?.volume) || 0,
        amount: 0,
        date: starKlines.at(-1)?.day || "",
        time: "",
      } satisfies Quote);
    const liveStarKlines = appendIntradayBar(starKlines, starQuote);
    const star50 = buildIndex(liveStarKlines, starQuote, benchmark);
    const targets = series
      .filter((item) => TARGETS.has(item.member.symbol))
      .map((item) =>
        buildStock(
          item,
          PCB_SYMBOLS.has(item.member.symbol) ? sector : null,
          benchmark,
        ),
      );
    const chinaNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }),
    );
    const time = chinaNow.toTimeString().slice(0, 8);
    const currentQuoteDate =
      starQuote.date || series.find((item) => item.quote.date)?.quote.date || "";
    const chinaDate =
      `${chinaNow.getFullYear()}-${String(chinaNow.getMonth() + 1).padStart(2, "0")}-${String(chinaNow.getDate()).padStart(2, "0")}`;
    const marketOpen =
      currentQuoteDate === chinaDate &&
      chinaNow.getDay() >= 1 &&
      chinaNow.getDay() <= 5 &&
      ((time >= "09:25:00" && time <= "11:35:00") ||
        (time >= "12:55:00" && time <= "15:05:00"));

    return NextResponse.json({
      live: true,
      marketOpen,
      updatedAt: new Date().toISOString(),
      instruments: [star50, sector, ...targets],
      methodology: {
        title: "V15双确认买点＋第13版主卖点＋V12风险对照",
        sample:
          "科创50使用官方指数代码000688的独立行情；PCB采用15只核心PCB/覆铜板公司等权样本，不冒充官方行业指数；个股包括沪电股份、胜宏科技与阳光电源。阳光电源作为独立新能源个股，不计入PCB样本。",
        ranges:
          "0–20极弱；20–40偏弱；40–60中性；60–80偏强；80–100过热。分数越高代表趋势与风险偏好越强，不代表估值越低。",
        limitation:
          "视频没有公开指标间最大间隔，本模型固定为8个交易日。主卖点仍沿用第13版风险过滤器；V12二次确认卖点作为独立短线风险提醒显示，不替代主卖点。页面命中率不是未来收益承诺。",
      },
      members: ALL_STOCKS.map(({ code, name, role }) => ({ code, name, role })),
      source: "新浪财经公开行情 · 科创50(000688) · PCB核心样本等权",
    });
  } catch {
    return NextResponse.json(
      {
        live: false,
        error: "指数与PCB行情连接暂时繁忙，请点击重试",
      },
      { status: 503 },
    );
  }
}
