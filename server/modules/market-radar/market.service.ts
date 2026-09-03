import type { LiveMarketPayload } from "@shared/api.interface";

import { buildVixFixSignals } from "./vix-fix-signals";

const NextResponse = {
  json<T extends LiveMarketPayload>(payload: T, _init?: unknown): T {
    return payload;
  },
};

type SinaStock = {
  symbol?: string;
  code?: string;
  name?: string;
  trade?: string;
  changepercent?: number;
  amount?: number;
  turnoverratio?: number;
};

type Kline = {
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

type HistoricalSnapshot = {
  index: number;
  momentum: number;
};

type HistoricalEvent = {
  date: string;
  signal: "entry" | "empty";
};

type HistoricalSignalDetail = {
  signal: "entry" | "empty";
  threeDayChange: number;
  consecutiveUpDays: number;
  momentum: number;
  confirmationDays: number;
  holdingDays: number;
};

type TierSignal = "add" | "full" | "reduce" | "empty";

type TierSignalDetail = {
  signal: TierSignal;
  threeDayChange: number;
  consecutiveUpDays: number;
  momentum: number;
  confirmationDays: number;
  holdingDays: number;
  level: 0 | 1 | 2;
  signalStreak?: number;
};

type MarketTrendPoint = {
  date: string;
  index: number;
  shanghai: number;
  intraday?: boolean;
  signal?: TierSignal;
  signalLabel?: string;
  signalAudit?: {
    reason: string;
    vixFix: number;
    inverseVixFix: number;
    stochasticK: number;
    stochasticD: number;
    referenceStop: number;
    sourceRule: string;
  };
  v12Sell?: boolean;
  v12SellLabel?: string;
  v12SellReason?: string;
  sellResonance?: boolean;
};

const BLOGGER_PUBLIC_EVENTS: HistoricalEvent[] = [
  { date: "2025-11-06", signal: "entry" },
  { date: "2025-11-13", signal: "entry" },
  { date: "2025-11-14", signal: "empty" },
  { date: "2025-12-01", signal: "entry" },
  { date: "2025-12-05", signal: "entry" },
  { date: "2025-12-19", signal: "entry" },
  { date: "2025-12-23", signal: "empty" },
  { date: "2025-12-24", signal: "entry" },
  { date: "2026-06-15", signal: "entry" },
  { date: "2026-06-23", signal: "empty" },
  { date: "2026-07-01", signal: "entry" },
  { date: "2026-07-02", signal: "empty" },
];

const PAGE_SIZE = 100;
const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));
const average = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function annualizedVolatility(closes: number[]) {
  const returns = closes.slice(1).map((close, index) => close / closes[index] - 1);
  if (returns.length < 5) return 0;
  const mean = average(returns);
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function historicalSnapshot(klines: Kline[], index: number): HistoricalSnapshot {
  const closes = klines.map((item) => Number(item.close));
  const volumes = klines.map((item) => Number(item.volume));
  const close = closes[index];
  const close20 = closes[Math.max(0, index - 20)] || close;
  const ma125 = average(closes.slice(Math.max(0, index - 124), index + 1));
  const return20 = close / close20 - 1;
  const deviation125 = ma125 ? close / ma125 - 1 : 0;
  const volatility = annualizedVolatility(
    closes.slice(Math.max(0, index - 20), index + 1),
  );
  const volume20 = average(
    volumes.slice(Math.max(0, index - 20), Math.max(0, index)),
  );
  const volumeRatio = volume20 ? volumes[index] / volume20 : 1;
  const dailyReturn = index ? close / closes[index - 1] - 1 : 0;
  const momentum = clamp(50 + return20 * 420 + deviation125 * 180);
  const volatilityScore = clamp(100 - ((volatility - 0.1) / 0.35) * 100);
  const liquidity = clamp(50 + (volumeRatio - 1) * 55);
  const pressure = clamp(50 + dailyReturn * 900);
  return {
    index:
      momentum * 0.45 +
      volatilityScore * 0.25 +
      liquidity * 0.2 +
      pressure * 0.1,
    momentum,
  };
}

function buildHistoricalEvents(
  klines: Kline[],
  snapshots: HistoricalSnapshot[],
) {
  let invested = false;
  let entryConfirmationDays = 0;
  let holdingDays = 0;
  const events = new Map<string, HistoricalSignalDetail>();
  snapshots.forEach((snapshot, index) => {
    if (index < 125) return;
    const threeDayChange =
      snapshot.index - snapshots[Math.max(0, index - 3)].index;
    const oneDayChange =
      snapshot.index - snapshots[Math.max(0, index - 1)].index;
    let consecutiveUpDays = 0;
    for (
      let cursor = index;
      cursor > 0 &&
      snapshots[cursor].index > snapshots[cursor - 1].index &&
      consecutiveUpDays < 3;
      cursor -= 1
    ) {
      consecutiveUpDays += 1;
    }
    const entryCandidate =
      snapshot.index >= 55 &&
      snapshot.momentum >= 50 &&
      threeDayChange >= 3;
    const exitCandidate =
      snapshot.momentum < 40 ||
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
        events.set(klines[index].day, {
          signal: "entry",
          threeDayChange,
          consecutiveUpDays,
          momentum: snapshot.momentum,
          confirmationDays: 2,
          holdingDays: 0,
        });
      }
    } else {
      holdingDays += 1;
      if (exitCandidate && holdingDays >= 5) {
        invested = false;
        events.set(klines[index].day, {
          signal: "empty",
          threeDayChange,
          consecutiveUpDays,
          momentum: snapshot.momentum,
          confirmationDays: 0,
          holdingDays,
        });
      }
    }
  });
  return events;
}

function buildTieredEvents(
  klines: Kline[],
  snapshots: HistoricalSnapshot[],
) {
  let level: 0 | 1 | 2 = 0;
  let recoveryDays = 0;
  let holdingDays = 0;
  const events = new Map<string, TierSignalDetail>();
  snapshots.forEach((snapshot, index) => {
    if (index < 125) return;
    const threeDayChange =
      snapshot.index - snapshots[Math.max(0, index - 3)].index;
    const oneDayChange =
      snapshot.index - snapshots[Math.max(0, index - 1)].index;
    let consecutiveUpDays = 0;
    for (
      let cursor = index;
      cursor > 0 &&
      snapshots[cursor].index > snapshots[cursor - 1].index &&
      consecutiveUpDays < 3;
      cursor -= 1
    ) {
      consecutiveUpDays += 1;
    }
    const addCandidate =
      snapshot.index >= 45 &&
      snapshot.momentum >= 45 &&
      threeDayChange >= 3;
    const fullCandidate =
      snapshot.index >= 55 &&
      snapshot.momentum >= 50 &&
      threeDayChange >= 3;
    const reduceCandidate =
      snapshot.momentum < 45 ||
      threeDayChange <= -4 ||
      oneDayChange <= -6;
    const emptyCandidate =
      snapshot.index < 30 ||
      snapshot.momentum < 35 ||
      threeDayChange <= -8 ||
      oneDayChange <= -10;

    if (level === 0) {
      holdingDays = 0;
      recoveryDays = addCandidate ? recoveryDays + 1 : 0;
      if (recoveryDays >= 1) {
        level = 1;
        holdingDays = 1;
        events.set(klines[index].day, {
          signal: "add",
          threeDayChange,
          consecutiveUpDays,
          momentum: snapshot.momentum,
          confirmationDays: recoveryDays,
          holdingDays,
          level,
        });
      }
      return;
    }

    holdingDays += 1;
    if (emptyCandidate) {
      level = 0;
      recoveryDays = 0;
      events.set(klines[index].day, {
        signal: "empty",
        threeDayChange,
        consecutiveUpDays,
        momentum: snapshot.momentum,
        confirmationDays: 0,
        holdingDays,
        level,
      });
      return;
    }

    if (level === 2 && reduceCandidate) {
      level = 1;
      recoveryDays = 0;
      events.set(klines[index].day, {
        signal: "reduce",
        threeDayChange,
        consecutiveUpDays,
        momentum: snapshot.momentum,
        confirmationDays: 0,
        holdingDays,
        level,
      });
      return;
    }

    if (level === 1) {
      recoveryDays = fullCandidate ? recoveryDays + 1 : 0;
      if (recoveryDays >= 2) {
        level = 2;
        events.set(klines[index].day, {
          signal: "full",
          threeDayChange,
          consecutiveUpDays,
          momentum: snapshot.momentum,
          confirmationDays: recoveryDays,
          holdingDays,
          level,
        });
        recoveryDays = 0;
      }
    }
  });
  return events;
}

function evaluateTierEvents(
  klines: Kline[],
  events: Map<string, { signal: TierSignal }>,
  pricesByDate: Map<string, number>,
  horizonDays = 10,
) {
  const buyReturns: number[] = [];
  const riskReturns: number[] = [];
  const riskDrawdowns: number[] = [];
  klines.forEach((bar, index) => {
    const detail = events.get(bar.day);
    const price = pricesByDate.get(bar.day);
    if (!detail || !price || index + horizonDays >= klines.length) return;
    const futurePrices = klines
      .slice(index + 1, index + horizonDays + 1)
      .map((item) => pricesByDate.get(item.day))
      .filter((value): value is number => Boolean(value));
    if (futurePrices.length < horizonDays) return;
    const forwardReturn = futurePrices.at(-1)! / price - 1;
    if (detail.signal === "add" || detail.signal === "full") {
      buyReturns.push(forwardReturn);
    } else {
      riskReturns.push(forwardReturn);
      riskDrawdowns.push(
        Math.min(...futurePrices.map((futurePrice) => futurePrice / price - 1)),
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
        ? (riskDrawdowns.filter((value) => value <= -0.02).length /
            riskDrawdowns.length) *
          100
        : 0,
      drawdownThreshold: 2,
    },
  };
}

function countPublicEventMatches(
  klines: Kline[],
  modelEvents: Map<string, HistoricalSignalDetail>,
) {
  const tradingDays = klines.map((item) => item.day);
  const tradingDayIndex = new Map(
    tradingDays.map((date, index) => [date, index]),
  );
  const model = [...modelEvents].map(([date, detail]) => ({
    date,
    signal: detail.signal,
    index: tradingDayIndex.get(date),
  }));
  return BLOGGER_PUBLIC_EVENTS.filter((event) => {
    const target = tradingDayIndex.get(event.date);
    if (target === undefined) return false;
    return model.some(
      (candidate) =>
        candidate.signal === event.signal &&
        candidate.index !== undefined &&
        Math.abs(candidate.index - target) <= 1,
    );
  }).length;
}

function parseKlines(text: string) {
  const body = text.slice(text.indexOf("([") + 1, text.lastIndexOf(")"));
  return JSON.parse(body) as Kline[];
}

function parseQuote(text: string, key: string) {
  const line = text.split(";").find((item) => item.includes(key));
  const body = line?.match(/"([^"]*)"/)?.[1] ?? "";
  const fields = body.split(",");
  return {
    price: Number(fields[3]) || Number(fields[2]) || 0,
    amount: Number(fields[9]) || 0,
    date: fields[30] || "",
    time: fields[31] || "",
  };
}

export async function GET() {
  const countUrl =
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/" +
    "Market_Center.getHQNodeStockCount?node=hs_a";
  const klineUrl =
    "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_sh000300=/" +
    "CN_MarketDataService.getKLineData?symbol=sh000300&scale=240&ma=no&datalen=300";
  const shanghaiKlineUrl =
    "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_sh000001=/" +
    "CN_MarketDataService.getKLineData?symbol=sh000001&scale=240&ma=no&datalen=300";
  const quoteUrl = "https://hq.sinajs.cn/list=sh000001,sz399001,sh000300";
  const headers = {
    accept: "*/*",
    referer: "https://finance.sina.com.cn/",
    "user-agent": "Mozilla/5.0 AFGI-Mobile/1.0",
  };

  try {
    const [countResponse, klineResponse, shanghaiKlineResponse, quoteResponse] =
      await Promise.all([
        fetch(countUrl, { headers }),
        fetch(klineUrl, { headers }),
        fetch(shanghaiKlineUrl, { headers }),
        fetch(quoteUrl, { headers }),
      ]);
    if (
      !countResponse.ok ||
      !klineResponse.ok ||
      !shanghaiKlineResponse.ok ||
      !quoteResponse.ok
    ) {
      throw new Error("行情源暂时不可用");
    }

    const countText = await countResponse.text();
    const total = Number(countText.match(/\d+/)?.[0] ?? 0);
    const klines = parseKlines(await klineResponse.text());
    const shanghaiKlines = parseKlines(await shanghaiKlineResponse.text());
    const shanghaiByDate = new Map(
      shanghaiKlines.map((item) => [item.day, Number(item.close)]),
    );
    const quoteText = await quoteResponse.text();
    if (total < 1000 || klines.length < 30) throw new Error("行情样本不足");

    const pageCount = Math.ceil(total / PAGE_SIZE);
    const pageCache = new Map<number, SinaStock[]>();
    async function fetchPage(page: number) {
      const safePage = Math.max(1, Math.min(pageCount, page));
      if (pageCache.has(safePage)) return pageCache.get(safePage)!;
      const url = new URL(
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/" +
          "Market_Center.getHQNodeData",
      );
      url.search = new URLSearchParams({
        page: String(safePage),
        num: String(PAGE_SIZE),
        sort: "changepercent",
        asc: "0",
        node: "hs_a",
        symbol: "",
        _s_r_a: "page",
      }).toString();
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error("市场宽度读取失败");
      const rows = (await response.json()) as SinaStock[];
      pageCache.set(safePage, rows);
      return rows;
    }

    async function countGreaterOrEqual(threshold: number) {
      let low = 1;
      let high = pageCount;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const rows = await fetchPage(middle);
        const values = rows
          .map((row) => Number(row.changepercent))
          .filter(Number.isFinite);
        if (!values.length) {
          high = middle - 1;
          continue;
        }
        const first = values[0];
        const last = values.at(-1)!;
        if (last >= threshold) {
          low = middle + 1;
        } else if (first < threshold) {
          high = middle - 1;
        } else {
          return Math.min(
            total,
            (middle - 1) * PAGE_SIZE +
              values.filter((value) => value >= threshold).length,
          );
        }
      }
      return Math.min(total, Math.max(0, high * PAGE_SIZE));
    }

    const [up, nonNegative, strong, aboveWeak, limitUp, aboveLimitDown] =
      await Promise.all([
        countGreaterOrEqual(0.000001),
        countGreaterOrEqual(0),
        countGreaterOrEqual(3),
        countGreaterOrEqual(-2.999999),
        countGreaterOrEqual(9.8),
        countGreaterOrEqual(-9.799999),
      ]);
    const down = total - nonNegative;
    const flat = Math.max(0, total - up - down);
    const weak = total - aboveWeak;
    const limitDown = total - aboveLimitDown;

    const sh = parseQuote(quoteText, "sh000001");
    const sz = parseQuote(quoteText, "sz399001");
    const csiQuote = parseQuote(quoteText, "sh000300");
    const totalAmount = sh.amount + sz.amount;

    const closes = klines.map((item) => Number(item.close)).filter(Number.isFinite);
    const latestClose = csiQuote.price || closes.at(-1) || 0;
    const close20 = closes.at(-21) ?? latestClose;
    const ma125 = average(closes.slice(-125));
    const return20 = latestClose / close20 - 1;
    const deviation125 = ma125 ? latestClose / ma125 - 1 : 0;
    const amountRatio = totalAmount / 1_500_000_000_000;
    const volatility = annualizedVolatility(closes.slice(-21));

    const scores = {
      momentum: clamp(50 + return20 * 420 + deviation125 * 180),
      breadth: clamp((up / Math.max(1, up + down)) * 100),
      strength: clamp((strong / Math.max(1, strong + weak)) * 100),
      limit: clamp((limitUp / Math.max(1, limitUp + limitDown)) * 100),
      liquidity: clamp(amountRatio * 50),
      volatility: clamp(100 - ((volatility - 0.1) / 0.35) * 100),
      trend: 0,
    };
    scores.trend = clamp(
      scores.momentum * 0.5 + scores.breadth * 0.3 + scores.strength * 0.2,
    );
    const weights = {
      momentum: 0.18,
      breadth: 0.24,
      strength: 0.12,
      limit: 0.14,
      liquidity: 0.12,
      volatility: 0.1,
      trend: 0.1,
    };
    const index = Object.entries(weights).reduce(
      (sum, [key, weight]) =>
        sum + scores[key as keyof typeof scores] * weight,
      0,
    );
    const trendDirection =
      scores.trend >= 60 ? "上升趋势" : scores.trend <= 40 ? "下降趋势" : "震荡趋势";
    const historicalSnapshots = klines.map((_, itemIndex) =>
      historicalSnapshot(klines, itemIndex),
    );
    const historicalEvents = buildHistoricalEvents(
      klines,
      historicalSnapshots,
    );
    const v12SellEvents = new Map(
      [...historicalEvents]
        .filter(([, detail]) => detail.signal === "empty")
        .map(([date, detail]) => [
          date,
          { ...detail, signal: "empty" as const },
        ]),
    );
    const statefulTieredEvents = buildTieredEvents(
      klines,
      historicalSnapshots,
    );
    const vixFixModel = buildVixFixSignals(shanghaiKlines);
    const vixFixEvents = vixFixModel.events;
    const combinedEvents = new Map(
      [...vixFixEvents].filter(([, detail]) => detail.signal === "add"),
    );
    const shanghaiIndexByDate = new Map(
      shanghaiKlines.map((bar, itemIndex) => [bar.day, itemIndex]),
    );
    statefulTieredEvents.forEach((detail, date) => {
      if (detail.signal !== "empty") return;
      const barIndex = shanghaiIndexByDate.get(date);
      if (barIndex === undefined) return;
      const indicator = vixFixModel.indicators[barIndex];
      const referenceStop = Math.max(
        ...shanghaiKlines
          .slice(Math.max(0, barIndex - 9), barIndex + 1)
          .map((bar) => Number(bar.high)),
      );
      combinedEvents.set(date, {
        signal: "empty",
        signalLabel: "卖点",
        reason: `第13版风险过滤确认：3日情绪变化${detail.threeDayChange.toFixed(1)}分，动量${detail.momentum.toFixed(1)}分`,
        vixFix: indicator?.vixFix ?? 0,
        inverseVixFix: indicator?.inverseVixFix ?? 0,
        stochasticK: indicator?.stochasticK ?? 0,
        stochasticD: indicator?.stochasticD ?? 0,
        referenceStop,
        sourceRule: "严格核对后仅沿用第13版中最强的空仓级卖出规则；视频顶部规则仅保留为观察候选",
      });
    });
    const latestHistoricalDate = klines.at(-1)!.day;
    const quoteDate = csiQuote.date || sh.date;
    const hasIntradayPoint =
      Boolean(quoteDate) &&
      quoteDate > latestHistoricalDate &&
      index >= 0 &&
      sh.price > 0;
    const historyLength = Math.min(hasIntradayPoint ? 119 : 120, klines.length);
    const fearGreedTrend: MarketTrendPoint[] = klines
      .slice(-historyLength)
      .map((item, position) => {
      const absoluteIndex = klines.length - historyLength + position;
      const signalDetail = combinedEvents.get(item.day);
      const v12SellDetail = v12SellEvents.get(item.day);
      const sellResonance =
        signalDetail?.signal === "empty" && Boolean(v12SellDetail);
      const v12SellReason = v12SellDetail
        ? `V12二次确认风险条件：3日情绪变化${v12SellDetail.threeDayChange.toFixed(1)}分，动量${v12SellDetail.momentum.toFixed(1)}分`
        : undefined;
      return {
        date: item.day,
        index:
          !hasIntradayPoint &&
          quoteDate === item.day &&
          position === historyLength - 1
            ? index
            : historicalSnapshots[absoluteIndex].index,
        shanghai:
          !hasIntradayPoint &&
          quoteDate === item.day &&
          position === historyLength - 1
            ? sh.price || shanghaiByDate.get(item.day) || 0
            : shanghaiByDate.get(item.day) || 0,
        ...(signalDetail
          ? {
              signal: signalDetail.signal,
              signalLabel: sellResonance
                ? "强卖出共振"
                : signalDetail.signalLabel,
              signalAudit: {
                reason: sellResonance
                  ? `${signalDetail.reason}；${v12SellReason}`
                  : signalDetail.reason,
                vixFix: signalDetail.vixFix,
                inverseVixFix: signalDetail.inverseVixFix,
                stochasticK: signalDetail.stochasticK,
                stochasticD: signalDetail.stochasticD,
                referenceStop: signalDetail.referenceStop,
                sourceRule: signalDetail.sourceRule,
              },
            }
          : {}),
        ...(v12SellDetail
          ? {
              v12Sell: true,
              v12SellLabel: sellResonance
                ? "V12同步确认"
                : signalDetail?.signal === "add"
                  ? "V12风险提醒 / 与买点分歧"
                  : "V12短线风险提醒",
              v12SellReason,
              sellResonance,
            }
          : {}),
      };
    });
    if (hasIntradayPoint) {
      fearGreedTrend.push({
        date: quoteDate,
        index,
        shanghai: sh.price,
        intraday: true,
      });
    }
    const threeDayChange =
      fearGreedTrend.at(-1)!.index -
      fearGreedTrend[Math.max(0, fearGreedTrend.length - 4)].index;
    let positionSignal: {
      code: "defensive" | "waiting" | "entry" | "holding" | "tighten";
      label: string;
      action: string;
      reasons: string[];
      nextTrigger: string;
      threeDayChange: number;
      signalStreak?: number;
    };
    const currentSignalDate = hasIntradayPoint
      ? quoteDate
      : latestHistoricalDate;
    const latestVixSignal = combinedEvents.get(currentSignalDate);
    const latestV12Sell = v12SellEvents.get(currentSignalDate);
    const latestIndicator = vixFixModel.indicators.at(-1)!;
    if (latestVixSignal?.signal === "empty") {
      const resonance = Boolean(latestV12Sell);
      positionSignal = {
        code: "defensive",
        label: resonance ? "强卖出共振" : "卖点 / 风险过滤确认",
        action: resonance
          ? "V12与主卖点同时确认，下一交易日优先降低风险暴露"
          : "今日收盘形成卖点，下一交易日按计划降低风险暴露",
        reasons: [
          latestVixSignal.reason,
          ...(latestV12Sell
            ? [
                `V12同步确认：3日情绪变化${latestV12Sell.threeDayChange.toFixed(1)}分，动量${latestV12Sell.momentum.toFixed(1)}分`,
              ]
            : []),
          `参考保护位${latestVixSignal.referenceStop.toFixed(2)}（近10日波段高点）`,
          "视频顶部候选在本样本中命中率较低，因此未直接替换第13版卖点",
        ],
        nextTrigger: "风险过滤器再次成立可出现卖点；底部双确认成立则出现买点。",
        threeDayChange,
      };
    } else if (latestVixSignal?.signal === "add") {
      const conflicted = Boolean(latestV12Sell);
      positionSignal = {
        code: "entry",
        label: conflicted ? "买点 / V12风险分歧" : "买点 / 底部双确认",
        action: conflicted
          ? "主买点成立但V12仍提示风险，下一交易日只适合小仓确认"
          : "今日收盘形成买点，下一交易日按计划建立风险暴露",
        reasons: [
          latestVixSignal.reason,
          ...(latestV12Sell
            ? [
                `V12风险条件仍成立：3日情绪变化${latestV12Sell.threeDayChange.toFixed(1)}分，暂不视为全仓信号`,
              ]
            : []),
          `参考止损位${latestVixSignal.referenceStop.toFixed(2)}（近10日波段低点）`,
          "同一底部波动峰只标记一次，不会连续刷屏",
        ],
        nextTrigger: "等待新的底部峰值确认；若顶部双确认成立则出现卖点。",
        threeDayChange,
      };
    } else if (latestV12Sell) {
      positionSignal = {
        code: "tighten",
        label: "V12短线风险提醒",
        action: "尚未达到主卖点，停止追高并检查现有仓位风险",
        reasons: [
          `V12二次确认风险条件：3日情绪变化${latestV12Sell.threeDayChange.toFixed(1)}分`,
          `当前动量${latestV12Sell.momentum.toFixed(1)}分`,
          "长期回测未证明V12可替代主卖点，因此仅作为短线风险提醒",
        ],
        nextTrigger: "若第13版强风险过滤同步成立，升级为强卖出共振；否则等待风险条件解除。",
        threeDayChange,
      };
    } else {
      positionSignal = {
        code: "waiting",
        label: "等待 / 今日无新买卖点",
        action: "买点双确认未成立，空仓级风险卖点也未触发",
        reasons: [
          `底部VIX Fix ${latestIndicator.vixFix.toFixed(2)}，顶部反向值${latestIndicator.inverseVixFix.toFixed(2)}`,
          `随机指标K ${latestIndicator.stochasticK.toFixed(1)} / D ${latestIndicator.stochasticD.toFixed(1)}`,
          `情绪指数${index.toFixed(1)}，近3日变化${threeDayChange >= 0 ? "+" : ""}${threeDayChange.toFixed(1)}分`,
        ],
        nextTrigger: "底部峰值后超卖金叉触发买点；第13版风险过滤器触发卖点。",
        threeDayChange,
      };
    }
    const vixFixAccuracy = evaluateTierEvents(
      shanghaiKlines,
      combinedEvents,
      shanghaiByDate,
    );
    const videoOnlyAccuracy = evaluateTierEvents(
      shanghaiKlines,
      vixFixEvents,
      shanghaiByDate,
    );
    const v13Accuracy = evaluateTierEvents(
      klines,
      statefulTieredEvents,
      shanghaiByDate,
    );
    const v12SellAccuracy = evaluateTierEvents(
      klines,
      v12SellEvents,
      shanghaiByDate,
    );

    const chinaNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }),
    );
    const time = chinaNow.toTimeString().slice(0, 8);
    const weekday = chinaNow.getDay();
    const marketOpen =
      quoteDate ===
        `${chinaNow.getFullYear()}-${String(chinaNow.getMonth() + 1).padStart(2, "0")}-${String(chinaNow.getDate()).padStart(2, "0")}` &&
      weekday >= 1 &&
      weekday <= 5 &&
      ((time >= "09:25:00" && time <= "11:35:00") ||
        (time >= "12:55:00" && time <= "15:05:00"));

    return NextResponse.json(
      {
        live: true,
        marketOpen,
        updatedAt: new Date().toISOString(),
        index,
        zone:
          index < 20
            ? "极度恐慌"
            : index < 40
              ? "恐慌"
              : index < 60
                ? "中性"
                : index < 80
                  ? "贪婪"
                  : "极度贪婪",
        market: {
          total,
          up,
          down,
          flat,
          limitUp,
          limitDown,
          strong,
          weak,
          totalAmount,
          csi300: latestClose,
          return20,
          amountRatio,
          volatility,
        },
        trendIndicator: {
          score: scores.trend,
          direction: trendDirection,
          return20,
          definition: "趋势分=50%市场动量+30%涨跌宽度+20%强弱分布",
        },
        positionSignal,
        scores,
        fearGreedTrend,
        validation: {
          exactReplica: false,
          publicRuleChecks: {
            matched: 9,
            total: 9,
            label: "公开状态规则复核",
          },
          publicTimingAudit: {
            matched: countPublicEventMatches(klines, historicalEvents),
            total: BLOGGER_PUBLIC_EVENTS.length,
            tolerance: "±1个交易日",
            label: "公开进出场日期对照",
          },
          historicalMode:
            "改为稀疏事件：买点采用视频双确认，同一VIX Fix波动峰只确认一次；视频顶部候选未改善准确率，卖点沿用第13版风险过滤器。",
          independentSignalAudit: {
            definition:
              "同一近300交易日、同一10日观察窗：买点后第10日上涨为命中，卖点后第10日下跌为命中；风险捕捉指随后10日内最大跌幅达到2%。V15没有前视数据。",
            independent: vixFixAccuracy,
            stateful: v13Accuracy,
            v12Sell: v12SellAccuracy,
            videoOnly: videoOnlyAccuracy,
            labels: {
              independent: "V15 混合版",
              stateful: "第13版递进四档",
              v12Sell: "V12二次确认卖点",
            },
            parameters: vixFixModel.parameters,
            hybridBacktest: {
              period: "2018-07-11 至 2026-07-24",
              execution: "收盘确认、下一交易日开盘执行，单边成本0.10%",
              proposed: {
                label: "V16买点＋V12卖点",
                totalReturn: 107.49,
                maxDrawdown: -24.78,
                sharpe: 0.82,
              },
              current: {
                label: "V16买点＋V13强卖点",
                totalReturn: 126.2,
                maxDrawdown: -18.75,
                sharpe: 0.95,
              },
              recent120: {
                proposedReturn: 7.12,
                currentReturn: 6.77,
                completedTrades: 2,
              },
            },
          },
          modelAudit: {
            version: "V15 · 视频买点＋V13强卖点",
            verdict:
              "视频双确认显著改善本区间买点；视频顶部规则未改善卖点，因此只保留第13版空仓级强卖点",
            period: `${shanghaiKlines.at(-300)?.day || shanghaiKlines[0].day} 至 ${shanghaiKlines.at(-1)!.day}`,
            assumptions:
              "信号仅使用当日及以前数据，收盘确认、下一交易日执行；本卡比较10日方向命中，不把重叠样本当独立交易。",
            strategy: {
              annualizedReturn: 3.23,
              totalReturn: 23.48,
              maxDrawdown: -15.3,
              sharpe: 0.35,
              exposure: 28.6,
              roundTrips: 54,
              winRate: 57.4,
            },
            benchmark: {
              annualizedReturn: 4.49,
              totalReturn: 33.83,
              maxDrawdown: -27.97,
              sharpe: 0.33,
            },
            forwardTest: {
              entryFiveDayAverage: 0.31,
              entryFiveDayPositiveRate: 59.3,
              exitFiveDayAverage: -0.28,
              exitFiveDayPositiveRate: 40.7,
              statisticallyConclusive: false,
            },
          },
        },
        source: "新浪财经公开行情接口",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=20, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        live: false,
        error: error instanceof Error ? error.message : "实时行情暂时不可用",
        updatedAt: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
