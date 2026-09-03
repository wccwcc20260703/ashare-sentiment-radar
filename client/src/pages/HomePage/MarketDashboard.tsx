"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@lark-apaas/client-toolkit/logger";

import { getMarketPayload } from "@client/src/api";
import { SecurityRadar } from "./SecurityRadar";

type TrendPoint = {
  date: string;
  index: number;
  shanghai: number;
  intraday?: boolean;
  signal?: "add" | "full" | "reduce" | "empty";
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

type MarketData = {
  live: boolean;
  marketOpen: boolean;
  updatedAt: string;
  index: number;
  zone: string;
  market: {
    total: number;
    up: number;
    down: number;
    flat: number;
    limitUp: number;
    limitDown: number;
    strong: number;
    weak: number;
    totalAmount: number;
    csi300: number;
    return20: number;
    amountRatio: number;
    volatility: number;
  };
  trendIndicator: {
    score: number;
    direction: string;
    return20: number;
    definition: string;
  };
  positionSignal: {
    code: "defensive" | "waiting" | "entry" | "holding" | "tighten";
    label: string;
    action: string;
    reasons: string[];
    nextTrigger: string;
    threeDayChange: number;
    signalStreak?: number;
  };
  scores: Record<string, number>;
  fearGreedTrend: TrendPoint[];
  validation: {
    exactReplica: boolean;
    publicRuleChecks: {
      matched: number;
      total: number;
      label: string;
    };
    publicTimingAudit: {
      matched: number;
      total: number;
      tolerance: string;
      label: string;
    };
    historicalMode: string;
    independentSignalAudit?: {
      definition: string;
      independent: SignalAccuracy;
      stateful: SignalAccuracy;
      videoOnly?: SignalAccuracy;
      labels?: {
        independent: string;
        stateful: string;
        v12Sell?: string;
      };
      v12Sell?: SignalAccuracy;
      parameters?: {
        vixFix: string;
        stochastic: string;
        confirmationWindow: number;
        execution: string;
      };
      hybridBacktest?: {
        period: string;
        execution: string;
        proposed: BacktestSummary;
        current: BacktestSummary;
        recent120: {
          proposedReturn: number;
          currentReturn: number;
          completedTrades: number;
        };
      };
    };
    modelAudit: {
      version: string;
      verdict: string;
      period: string;
      assumptions: string;
      strategy: {
        annualizedReturn: number;
        totalReturn: number;
        maxDrawdown: number;
        sharpe: number;
        exposure: number;
        roundTrips: number;
        winRate: number;
      };
      benchmark: {
        annualizedReturn: number;
        totalReturn: number;
        maxDrawdown: number;
        sharpe: number;
      };
      forwardTest: {
        entryFiveDayAverage: number;
        entryFiveDayPositiveRate: number;
        exitFiveDayAverage: number;
        exitFiveDayPositiveRate: number;
        statisticallyConclusive: boolean;
      };
    };
  };
  source: string;
  error?: string;
};

type BacktestSummary = {
  label: string;
  totalReturn: number;
  maxDrawdown: number;
  sharpe: number;
};

type SignalAccuracy = {
  horizonDays: number;
  buy: {
    signals: number;
    hitRate: number;
    averageForwardReturn: number;
  };
  risk: {
    signals: number;
    hitRate: number;
    averageForwardReturn: number;
    drawdownCaptureRate: number;
    drawdownThreshold: number;
  };
};

const scoreNames: Record<string, string> = {
  momentum: "市场动量",
  breadth: "涨跌宽度",
  strength: "强弱分布",
  limit: "涨跌停生态",
  liquidity: "成交活跃度",
  volatility: "市场波动",
  trend: "趋势指标",
};

const scoreZone = (value: number) =>
  value < 20
    ? "极弱 / 极度恐慌"
    : value < 40
      ? "偏弱 / 恐慌"
      : value < 60
        ? "中性 / 分歧"
        : value < 80
          ? "偏强 / 贪婪"
          : "极强 / 极度贪婪";

const formatAmount = (value: number) =>
  `${(value / 100_000_000).toLocaleString("zh-CN", {
    maximumFractionDigits: 0,
  })}亿`;

function getIndicatorInfo(key: string, data: MarketData | null) {
  const value = data?.scores[key] ?? 0;
  const currentCurveValue = data?.fearGreedTrend?.at(-1)?.index;
  const common = {
    zone:
      key === "position"
        ? data?.positionSignal.label || "等待实时行情"
        : key === "coverage"
          ? "覆盖率用于标记数据完整度，不参加情绪分区"
          : key === "curve" && currentCurveValue !== undefined
            ? `${currentCurveValue.toFixed(1)}分，处于“${scoreZone(currentCurveValue)}”区间`
            : data
              ? `${value.toFixed(1)}分，处于“${scoreZone(value)}”区间`
              : "等待实时行情",
    ranges:
      key === "position"
        ? "主信号保留V15底部双确认买点与第13版强卖点；V12卖点独立作为短线风险提醒。V12与主卖点同日成立时升级为强卖出共振。"
        : "0–20极弱；20–40偏弱；40–60中性；60–80偏强；80–100极强。所有分项均为分数越高，风险偏好越强。",
  };
  const details: Record<string, { title: string; formula: string; current: string; meaning: string }> = {
    momentum: {
      title: "市场动量",
      formula: "20日收益率与沪深300相对125日均线位置综合转换为0–100分。",
      current: data
        ? `沪深300近20日收益为${(data.market.return20 * 100).toFixed(2)}%，当前动量分${value.toFixed(1)}。`
        : "等待实时行情",
      meaning: "低分表示中期趋势偏弱、价格处于均线下方；高分表示趋势向上且价格处于中期均线上方。",
    },
    breadth: {
      title: "涨跌宽度",
      formula: "上涨家数 ÷（上涨家数＋下跌家数）×100。",
      current: data
        ? `上涨${data.market.up}家，下跌${data.market.down}家，宽度分${value.toFixed(1)}。`
        : "等待实时行情",
      meaning: "反映上涨是否具有普遍性。指数上涨但宽度很低，通常意味着行情只由少数权重股推动。",
    },
    strength: {
      title: "强弱分布",
      formula: "涨幅≥3%的股票数 ÷（涨幅≥3%＋跌幅≤-3%的股票数）×100。",
      current: data
        ? `强势股${data.market.strong}家，弱势股${data.market.weak}家，强度分${value.toFixed(1)}。`
        : "等待实时行情",
      meaning: "衡量大涨股票与大跌股票的力量对比。低分代表亏钱效应扩散，高分代表强势股占主导。",
    },
    limit: {
      title: "涨跌停生态",
      formula: "近似涨停家数 ÷（近似涨停家数＋近似跌停家数）×100。",
      current: data
        ? `近似涨停${data.market.limitUp}家、跌停${data.market.limitDown}家，生态分${value.toFixed(1)}。`
        : "等待实时行情",
      meaning: "用于观察最极端的赚钱与亏钱效应。接近50表示双方相对平衡，明显低于50表示跌停压力更大。",
    },
    liquidity: {
      title: "成交活跃度",
      formula: "以上海与深圳市场实时成交额相对1.5万亿元基准映射为0–100分。",
      current: data
        ? `两市成交额约${formatAmount(data.market.totalAmount)}，活跃度分${value.toFixed(1)}。`
        : "等待实时行情",
      meaning: "低分表示资金参与不足；高分表示交易活跃。高成交并不必然上涨，需要与宽度和趋势一起判断。",
    },
    volatility: {
      title: "市场波动",
      formula: "根据沪深300近20日年化实现波动率反向评分：波动越大，得分越低。",
      current: data
        ? `近20日年化波动率约${(data.market.volatility * 100).toFixed(1)}%，波动分${value.toFixed(1)}。`
        : "等待实时行情",
      meaning: "低分表示价格震荡和风险压力较大；高分表示波动温和。过低时更应控制仓位和追涨风险。",
    },
    trend: {
      title: "趋势指标",
      formula: "50%市场动量＋30%涨跌宽度＋20%强弱分布。",
      current: data
        ? `当前趋势分${data.trendIndicator.score.toFixed(1)}，判定为“${data.trendIndicator.direction}”。`
        : "等待实时行情",
      meaning: "同时观察指数方向与个股扩散。60分以上为上升趋势，40分以下为下降趋势，中间为震荡。",
    },
    coverage: {
      title: "公开数据覆盖率",
      formula: "当前实时版已覆盖价格动量、涨跌宽度、强弱股、涨跌停、成交额、波动率和趋势；尚未纳入两融、期权PCR等授权/延迟数据。",
      current: "78%表示当前指数主要依赖公开可实时取得的数据，不代表预测准确率。",
      meaning: "覆盖率越高，指标维度越完整；它不是胜率，也不能用来替代仓位和止损规则。",
    },
    curve: {
      title: "情绪、买卖点与上证指数",
      formula: "青色线是0–100分情绪指数，紫色线是上证指数点位。橙色上三角是V15双确认买点，绿色下三角是第13版主卖点；开启对照后，浅绿色菱形是V12风险提醒，金圈是两套卖点共振。",
      current: data?.fearGreedTrend?.length
        ? `当前共提供${data.fearGreedTrend.length}个交易日；最新情绪${data.fearGreedTrend.at(-1)!.index.toFixed(1)}分，上证指数${data.fearGreedTrend.at(-1)!.shanghai.toFixed(2)}点。`
        : "等待实时行情",
      meaning: "两条线同向说明指数和情绪互相确认；上证上涨而情绪下降，说明上涨覆盖不足。买卖点是稀疏事件：同一个VIX Fix波动峰只确认一次。",
    },
    validation: {
      title: "验证与回测口径",
      formula: "V15买点、第13版主卖点与V12卖点使用同一10日观察窗比较。买点后第10日上涨、卖点后第10日下跌记为方向命中；所有指标只使用当日及以前数据。",
      current: data
        ? `${data.validation.modelAudit.version}：${data.validation.independentSignalAudit?.independent.buy.signals ?? 0}个买点、${data.validation.independentSignalAudit?.independent.risk.signals ?? 0}个主卖点、${data.validation.independentSignalAudit?.v12Sell?.risk.signals ?? 0}个V12对照卖点。`
        : "等待实时行情",
      meaning: "方向命中率只回答固定观察窗内方向是否正确，不等于完整交易收益。样本较少时即使百分比更高也不能视为统计证明。",
    },
    position: {
      title: "V15买点与双轨卖点",
      formula: "买点：Williams VIX Fix使用22/20/2/50/0.85参数，随机指标使用14/3/3，两个条件允许在8个交易日内确认。主卖点采用第13版强风险过滤；V12卖点只作短线提醒，同日成立时升级为共振。",
      current: data
        ? `当前为“${data.positionSignal.label}”：${data.positionSignal.action}。${data.positionSignal.reasons.join("；")}。`
        : "等待实时行情",
      meaning: "视频明确了双指标确认和波段高低点止损；8日确认窗口是视频未公开部分，本模型的透明量化假设。信号仍需配合个人仓位和止损。",
    },
  };
  return { ...(details[key] ?? details.curve), ...common };
}

function formatChartDate(date: string) {
  return date.length >= 10 ? date.slice(5) : date;
}

function formatFinite(value: number | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}

function FearGreedChart({ points }: { points: TrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [showV12Sells, setShowV12Sells] = useState(true);
  const [endIndex, setEndIndex] = useState(points.length - 1);
  const visibleCount = Math.min(windowDays, points.length);
  const safeEnd = Math.min(
    points.length - 1,
    Math.max(visibleCount - 1, endIndex),
  );
  const startIndex = Math.max(0, safeEnd - visibleCount + 1);
  const visiblePoints = points.slice(startIndex, safeEnd + 1);
  const [active, setActive] = useState(visiblePoints.length - 1);
  const safeActive = Math.min(
    Math.max(0, active),
    Math.max(0, visiblePoints.length - 1),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setEndIndex(points.length - 1), 0);
    return () => window.clearTimeout(timer);
  }, [points]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setActive(visiblePoints.length - 1),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [startIndex, safeEnd, visiblePoints.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visiblePoints.length) return;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);

      const left = 32;
      const right = 46;
      const top = 12;
      const bottom = 24;
      const chartWidth = width - left - right;
      const chartHeight = height - top - bottom;
      const x = (position: number) =>
        left + (position / Math.max(1, visiblePoints.length - 1)) * chartWidth;
      const y = (value: number) => top + ((100 - value) / 100) * chartHeight;
      const shanghaiValues = visiblePoints
        .map((point) => point.shanghai)
        .filter((value) => Number.isFinite(value) && value > 0);
      const shanghaiMin = Math.min(...shanghaiValues);
      const shanghaiMax = Math.max(...shanghaiValues);
      const shanghaiPadding = Math.max(8, (shanghaiMax - shanghaiMin) * 0.12);
      const shanghaiFloor = shanghaiMin - shanghaiPadding;
      const shanghaiCeiling = shanghaiMax + shanghaiPadding;
      const shanghaiY = (value: number) =>
        top +
        ((shanghaiCeiling - value) /
          Math.max(1, shanghaiCeiling - shanghaiFloor)) *
          chartHeight;

      context.clearRect(0, 0, width, height);
      const bands = [
        { from: 0, to: 20, color: "rgba(40,196,143,.07)" },
        { from: 20, to: 40, color: "rgba(82,213,208,.045)" },
        { from: 40, to: 60, color: "rgba(242,184,75,.035)" },
        { from: 60, to: 80, color: "rgba(242,184,75,.055)" },
        { from: 80, to: 100, color: "rgba(240,92,86,.075)" },
      ];
      bands.forEach((band) => {
        context.fillStyle = band.color;
        context.fillRect(left, y(band.to), chartWidth, y(band.from) - y(band.to));
      });

      context.font = "10px -apple-system, PingFang SC";
      context.textAlign = "right";
      context.textBaseline = "middle";
      [20, 40, 60, 80].forEach((value) => {
        context.strokeStyle = "rgba(151,185,194,.14)";
        context.lineWidth = 1;
        context.setLineDash([3, 5]);
        context.beginPath();
        context.moveTo(left, y(value));
        context.lineTo(width - right, y(value));
        context.stroke();
        context.fillStyle = "#68828c";
        context.fillText(String(value), left - 7, y(value));
      });
      context.setLineDash([]);

      context.fillStyle = "#727da3";
      context.font = "9px -apple-system, PingFang SC";
      context.textAlign = "left";
      context.fillText(
        Math.round(shanghaiCeiling).toLocaleString("zh-CN"),
        width - right + 7,
        top + 3,
      );
      context.fillText(
        Math.round(shanghaiFloor).toLocaleString("zh-CN"),
        width - right + 7,
        height - bottom - 3,
      );

      context.beginPath();
      visiblePoints.forEach((point, position) => {
        if (!point.shanghai) return;
        const px = x(position);
        const py = shanghaiY(point.shanghai);
        if (position === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.strokeStyle = "#8e9bff";
      context.lineWidth = 1.8;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);

      const gradient = context.createLinearGradient(0, top, 0, height - bottom);
      gradient.addColorStop(0, "rgba(82,213,208,.30)");
      gradient.addColorStop(1, "rgba(82,213,208,0)");
      context.beginPath();
      visiblePoints.forEach((point, position) => {
        const px = x(position);
        const py = y(point.index);
        if (position === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.lineTo(x(visiblePoints.length - 1), height - bottom);
      context.lineTo(x(0), height - bottom);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();

      context.beginPath();
      visiblePoints.forEach((point, position) => {
        const px = x(position);
        const py = y(point.index);
        if (position === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.strokeStyle = "#62d8d2";
      context.lineWidth = 2.5;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.shadowColor = "rgba(82,213,208,.35)";
      context.shadowBlur = 8;
      context.stroke();
      context.shadowBlur = 0;

      visiblePoints.forEach((point, position) => {
        if (!point.signal) return;
        const px = x(position);
        const py = point.shanghai
          ? shanghaiY(point.shanghai)
          : y(point.index);
        const isBuy = point.signal === "add";
        const isStrong = true;
        const markerY = Math.min(height - bottom - 12, Math.max(top + 12, py));
        context.beginPath();
        if (isBuy) {
          context.moveTo(px, markerY - 9);
          context.lineTo(px - 7, markerY + 4);
          context.lineTo(px + 7, markerY + 4);
        } else {
          context.moveTo(px, markerY + 9);
          context.lineTo(px - 7, markerY - 4);
          context.lineTo(px + 7, markerY - 4);
        }
        context.closePath();
        const signalColors = {
          add: "#ef9a68",
          full: "#f05c56",
          reduce: "#f2b84b",
          empty: "#28c48f",
        };
        context.fillStyle = isStrong
          ? signalColors[point.signal]
          : "rgba(7,19,31,.92)";
        context.fill();
        context.strokeStyle = signalColors[point.signal];
        context.lineWidth = isStrong ? 1.5 : 2;
        context.stroke();
        if (point.sellResonance && point.signal === "empty") {
          context.beginPath();
          context.arc(px, markerY, 11, 0, Math.PI * 2);
          context.strokeStyle = "#f2cf86";
          context.lineWidth = 1.6;
          context.stroke();
        }
        if (visiblePoints.length <= 60) {
          const signalText = {
            add: "买",
            full: "全",
            reduce: "减",
            empty: "卖",
          };
          context.fillStyle = signalColors[point.signal];
          context.font = "700 9px -apple-system, PingFang SC";
          context.textAlign = "center";
          context.fillText(
            point.sellResonance ? "共振" : signalText[point.signal],
            px,
            isBuy ? markerY - 16 : markerY + 17,
          );
        }
      });

      if (showV12Sells) {
        visiblePoints.forEach((point, position) => {
          if (!point.v12Sell || point.sellResonance) return;
          const px = x(position);
          const markerY = Math.min(
            height - bottom - 10,
            Math.max(
              top + 10,
              (point.shanghai ? shanghaiY(point.shanghai) : y(point.index)) +
                14,
            ),
          );
          context.save();
          context.translate(px, markerY);
          context.rotate(Math.PI / 4);
          context.beginPath();
          context.rect(-5, -5, 10, 10);
          context.fillStyle = "rgba(7,19,31,.92)";
          context.fill();
          context.strokeStyle = "#b8df7a";
          context.lineWidth = 1.8;
          context.stroke();
          context.restore();
          if (visiblePoints.length <= 60) {
            context.fillStyle = "#b8df7a";
            context.font = "700 8px -apple-system, PingFang SC";
            context.textAlign = "center";
            context.fillText("V12", px, markerY + 15);
          }
        });
      }

      const selected = visiblePoints[safeActive];
      if (selected) {
        const px = x(safeActive);
        const py = y(selected.index);
        context.strokeStyle = "rgba(236,244,245,.22)";
        context.setLineDash([3, 4]);
        context.beginPath();
        context.moveTo(px, top);
        context.lineTo(px, height - bottom);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(px, py, 4.5, 0, Math.PI * 2);
        context.fillStyle = "#f2b84b";
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "#07131f";
        context.stroke();
        if (selected.shanghai) {
          context.beginPath();
          context.arc(px, shanghaiY(selected.shanghai), 3.5, 0, Math.PI * 2);
          context.fillStyle = "#8e9bff";
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = "#07131f";
          context.stroke();
        }
      }

      context.fillStyle = "#68828c";
      context.font = "10px -apple-system, PingFang SC";
      context.textAlign = "left";
      context.fillText(formatChartDate(visiblePoints[0].date), left, height - 8);
      context.textAlign = "center";
      context.fillText(
        formatChartDate(visiblePoints[Math.floor(visiblePoints.length / 2)].date),
        width / 2,
        height - 8,
      );
      context.textAlign = "right";
      context.fillText(formatChartDate(visiblePoints.at(-1)!.date), width - right, height - 8);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [safeActive, showV12Sells, visiblePoints]);

  const selected = visiblePoints[safeActive];
  const rangeStart = points[Math.max(0, windowDays - 1)] ? windowDays - 1 : 0;
  return (
    <div>
      <div className="chart-controls">
        <div className="chart-control-group">
          <div className="window-buttons" aria-label="选择趋势时间范围">
            {[30, 60, 120].map((days) => (
              <button
                key={days}
                className={windowDays === days ? "active" : ""}
                onClick={() => setWindowDays(days)}
                disabled={points.length < days}
              >
                {days}日
              </button>
            ))}
          </div>
          <label className="signal-compare-toggle">
            <input
              type="checkbox"
              checked={showV12Sells}
              onChange={(event) => setShowV12Sells(event.currentTarget.checked)}
            />
            <span>显示V12卖点</span>
          </label>
        </div>
        <span>{formatChartDate(visiblePoints[0]?.date || "")} — {formatChartDate(visiblePoints.at(-1)?.date || "")}</span>
      </div>
      <div className="fear-greed-chart">
        <canvas
          ref={canvasRef}
          aria-label={`可交互的${visibleCount}个交易日恐惧贪婪指数、上证指数与双确认买卖点曲线`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const relative = Math.min(1, Math.max(0, (event.clientX - bounds.left - 32) / Math.max(1, bounds.width - 78)));
            setActive(Math.round(relative * (visiblePoints.length - 1)));
          }}
          onPointerLeave={() => setActive(visiblePoints.length - 1)}
        />
        {selected && (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.min(
                86,
                Math.max(
                  14,
                  (safeActive /
                    Math.max(1, visiblePoints.length - 1)) *
                    100,
                ),
              )}%`,
            }}
          >
            <span>
              {formatChartDate(selected.date)}
              {selected.intraday ? " · 盘中" : ""}
            </span>
            <strong>情绪 {formatFinite(selected.index)}</strong>
            <b>上证 {formatFinite(selected.shanghai, 2)}</b>
            {selected.signalLabel && <em className={`tooltip-${selected.signal}`}>{selected.signalLabel}</em>}
            {selected.signalAudit && (
              <>
                <small>{selected.signalAudit.reason}</small>
                <small>
                  VIX Fix {formatFinite(selected.signalAudit.vixFix, 2)}
                  {" · "}K/D {formatFinite(selected.signalAudit.stochasticK)}
                  /{formatFinite(selected.signalAudit.stochasticD)}
                  {" · "}参考位 {formatFinite(selected.signalAudit.referenceStop, 2)}
                </small>
              </>
            )}
            {showV12Sells && selected.v12Sell && (
              <>
                <em className="tooltip-v12">{selected.v12SellLabel}</em>
                <small>{selected.v12SellReason}</small>
              </>
            )}
          </div>
        )}
      </div>
      <label className="time-slider">
        <span>拖动查看过去时段</span>
        <input
          type="range"
          min={rangeStart}
          max={Math.max(rangeStart, points.length - 1)}
          value={safeEnd}
          onInput={(event) => setEndIndex(Number(event.currentTarget.value))}
          disabled={points.length <= windowDays}
          aria-label="拖动趋势图时间范围"
        />
      </label>
    </div>
  );
}

export function MarketDashboard() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installTip, setInstallTip] = useState(false);
  const [infoKey, setInfoKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getMarketPayload<MarketData>();
      if (!next.live) throw new Error(next.error || "行情暂时不可用");
      setData(next);
      setError("");
    } catch (reason) {
      logger.error("A股市场行情刷新失败", reason);
      setError(reason instanceof Error ? reason.message : "刷新失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 60_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const rotation = data ? data.index * 1.8 - 180 : -180;
  const isStandalone =
    typeof window !== "undefined" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const trendChange =
    data?.fearGreedTrend?.length
      ? data.fearGreedTrend.at(-1)!.index - data.fearGreedTrend[0].index
      : 0;

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">A-SHARE SENTIMENT</p>
          <h1>A股情绪雷达</h1>
        </div>
        <button
          className="live-pill"
          onClick={refresh}
          aria-label="立即刷新实时行情"
        >
          <span className={data?.marketOpen ? "pulse" : "dot"} />
          {loading ? "连接中" : data?.marketOpen ? "盘中实时" : "最近行情"}
        </button>
      </header>

      {error && (
        <section className="error-card">
          <div>
            <strong>暂时未取得实时行情</strong>
            <p>{error}，请稍后下拉或点右上角重试。</p>
          </div>
          <button onClick={refresh}>重试</button>
        </section>
      )}

      <section className="hero-card">
        <div className="hero-copy">
          <p>贪婪与恐慌指数</p>
          <div className="index-row">
            <strong>{data ? data.index.toFixed(1) : "—"}</strong>
            <span>{data?.zone || "正在计算"}</span>
          </div>
          <p className="updated">
            {data
              ? `${new Date(data.updatedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Shanghai",
                })} 自动刷新`
              : "连接公开行情中"}
          </p>
        </div>
        <div className="gauge" aria-label={`情绪指数 ${data?.index ?? 0}`}>
          <div className="gauge-track" />
          <div className="needle" style={{ transform: `rotate(${rotation}deg)` }} />
          <div className="gauge-center" />
          <span className="fear-label">恐慌</span>
          <span className="greed-label">贪婪</span>
        </div>
      </section>

      <section className={`position-card signal-${data?.positionSignal.code || "waiting"}`}>
        <div className="position-card-head">
          <div>
            <p className="eyebrow">POSITION TIMING</p>
            <div className="title-with-info">
              <h2>V15买点＋双轨卖点</h2>
              <button className="info-button" onClick={() => setInfoKey("position")} aria-label="查看V15买点与双轨卖点含义">i</button>
            </div>
          </div>
          <span className="signal-badge">
            <i />
            {data?.positionSignal.label || "正在计算"}
          </span>
        </div>
        <div className="position-action">
          <span>当前模型动作</span>
          <strong>{data?.positionSignal.action || "连接市场数据中"}</strong>
        </div>
        <div className="position-reasons">
          {(data?.positionSignal.reasons || ["正在读取趋势、宽度与情绪变化"]).map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
        <div className="next-trigger">
          <span>下一状态触发条件</span>
          <p>{data?.positionSignal.nextTrigger || "正在计算"}</p>
        </div>
        <p className="position-disclaimer">
          信号按收盘确认并用于下一交易日；它是规则化观察工具，不是收益承诺，仍须服从个人仓位上限与止损。
        </p>
      </section>

      <section className="market-grid">
        <article className="stat-card up-card">
          <span>上涨</span>
          <strong>{data?.market.up.toLocaleString() ?? "—"}</strong>
          <small>全市场股票</small>
        </article>
        <article className="stat-card down-card">
          <span>下跌</span>
          <strong>{data?.market.down.toLocaleString() ?? "—"}</strong>
          <small>全市场股票</small>
        </article>
        <article className="stat-card">
          <span>涨停 / 跌停</span>
          <strong>
            {data ? `${data.market.limitUp} / ${data.market.limitDown}` : "—"}
          </strong>
          <small>按板块涨跌幅近似</small>
        </article>
        <article className="stat-card">
          <span>两市成交额</span>
          <strong>{data ? formatAmount(data.market.totalAmount) : "—"}</strong>
          <small>{data?.market.total.toLocaleString() ?? "—"}只样本</small>
        </article>
      </section>

      <section className="panel trend-indicator-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TREND INDICATOR</p>
            <div className="title-with-info">
              <h2>趋势指标</h2>
              <button className="info-button" onClick={() => setInfoKey("trend")} aria-label="查看趋势指标含义">i</button>
            </div>
          </div>
          <span
            className={`state ${
              data?.trendIndicator.direction === "上升趋势" ? "red" : "green"
            }`}
          >
            {data?.trendIndicator.direction || "正在计算"}
          </span>
        </div>
        <div className="trend-values">
          <div>
            <span>趋势分</span>
            <strong>{data?.trendIndicator.score.toFixed(1) ?? "—"}</strong>
          </div>
          <div>
            <span>沪深300 20日动量</span>
            <strong className={(data?.trendIndicator.return20 ?? 0) >= 0 ? "positive" : "negative"}>
              {data
                ? `${data.trendIndicator.return20 >= 0 ? "+" : ""}${(
                    data.trendIndicator.return20 * 100
                  ).toFixed(2)}%`
                : "—"}
            </strong>
          </div>
        </div>
        <p className="definition">
          {data?.trendIndicator.definition || "正在加载"}。60分以上为上升趋势，
          40分以下为下降趋势，其余为震荡趋势。
        </p>
      </section>

      <section className="panel history-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">HISTORY + POSITION SIGNALS</p>
            <div className="title-with-info">
              <h2>情绪、上证与双轨卖点</h2>
              <button className="info-button" onClick={() => setInfoKey("curve")} aria-label="查看历史曲线与信号含义">i</button>
            </div>
          </div>
          <div className="index-quote">
            <strong>{data?.fearGreedTrend.at(-1)?.index.toFixed(1) ?? "—"}</strong>
            <span className={trendChange >= 0 ? "positive" : "negative"}>
              {data ? `${trendChange >= 0 ? "+" : ""}${trendChange.toFixed(1)} / 可用历史` : "历史变化"}
            </span>
          </div>
        </div>
        {data?.fearGreedTrend?.length ? (
          <FearGreedChart points={data.fearGreedTrend} />
        ) : (
          <div className="chart-loading" />
        )}
        <div className="chart-legend">
          <span><i className="legend-sentiment-line" />情绪指数（左轴）</span>
          <span><i className="legend-shanghai-line" />上证指数（右轴）</span>
          <span><i className="legend-fear" />0–40 恐慌</span>
          <span><i className="legend-neutral" />40–60 中性</span>
          <span><i className="legend-greed" />60–100 贪婪</span>
          <span><i className="legend-add" />买点</span>
          <span><i className="legend-empty" />当前主卖点</span>
          <span><i className="legend-resonance" />强卖出共振</span>
          <span><i className="legend-v12" />V12风险提醒</span>
        </div>
        <p className="history-note">
          选择30/60/120日后，可拖动时间轴查看更早区间；触摸或移动到曲线上可查看每日数值。
          买点要求底部VIX Fix峰值与随机指标超卖金叉在8个交易日内同时确认，同一波动峰只标一次。
          买点、主卖点和V12卖点均标在上证指数价格线上；浅绿色菱形只作为短线风险提醒。
          两套卖点同日成立时标记为金圈“强卖出共振”，不会因为开启对照而覆盖原有买点。
        </p>
      </section>

      <SecurityRadar />

      <section className="panel validation-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AUDIT & LIMITATIONS</p>
            <div className="title-with-info">
              <h2>验证程度</h2>
              <button className="info-button" onClick={() => setInfoKey("validation")} aria-label="查看验证与回测口径">i</button>
            </div>
          </div>
          <span className="audit-status">{data?.validation.modelAudit.version || "模型审计"}</span>
        </div>
        <div className="audit-verdict">
          <span>严格审计结论</span>
          <strong>
            {data?.validation.modelAudit.verdict ||
              "正在读取长期回算结果"}
          </strong>
        </div>
        <div className="audit-grid">
          <article>
            <span>V15买点 · 10日命中</span>
            <strong>
              {data?.validation.independentSignalAudit
                ? `${data.validation.independentSignalAudit.independent.buy.hitRate.toFixed(1)}%`
                : "—"}
            </strong>
            <small>{data?.validation.independentSignalAudit?.independent.buy.signals ?? "—"}个已完成观察窗样本</small>
          </article>
          <article>
            <span>第13版买入类 · 10日命中</span>
            <strong>
              {data?.validation.independentSignalAudit
                ? `${data.validation.independentSignalAudit.stateful.buy.hitRate.toFixed(1)}%`
                : "—"}
            </strong>
            <small>{data?.validation.independentSignalAudit?.stateful.buy.signals ?? "—"}个已完成观察窗样本</small>
          </article>
          <article>
            <span>V15卖点 · 10日命中</span>
            <strong>
              {data?.validation.independentSignalAudit
                ? `${data.validation.independentSignalAudit.independent.risk.hitRate.toFixed(1)}%`
                : "—"}
            </strong>
            <small>{data?.validation.independentSignalAudit?.independent.risk.signals ?? "—"}个已完成观察窗样本</small>
          </article>
          <article>
            <span>第13版风险类 · 10日命中</span>
            <strong>
              {data?.validation.independentSignalAudit
                ? `${data.validation.independentSignalAudit.stateful.risk.hitRate.toFixed(1)}%`
                : "—"}
            </strong>
            <small>{data?.validation.independentSignalAudit?.stateful.risk.signals ?? "—"}个已完成观察窗样本</small>
          </article>
          <article>
            <span>V12卖点对照 · 10日命中</span>
            <strong>
              {data?.validation.independentSignalAudit?.v12Sell
                ? `${data.validation.independentSignalAudit.v12Sell.risk.hitRate.toFixed(1)}%`
                : "—"}
            </strong>
            <small>{data?.validation.independentSignalAudit?.v12Sell?.risk.signals ?? "—"}个已完成观察窗样本</small>
          </article>
        </div>
        {data?.validation.independentSignalAudit && (
          <div className="independent-audit">
            <span>第15版与第13版 · 同口径比较</span>
            <div>
              <p>
                V15买点
                <b>{data.validation.independentSignalAudit.independent.buy.hitRate.toFixed(1)}%</b>
                ，卖点
                <b>{data.validation.independentSignalAudit.independent.risk.hitRate.toFixed(1)}%</b>
              </p>
              <p>
                第13版买入类
                <b>{data.validation.independentSignalAudit.stateful.buy.hitRate.toFixed(1)}%</b>
                ，风险类
                <b>{data.validation.independentSignalAudit.stateful.risk.hitRate.toFixed(1)}%</b>
              </p>
            </div>
            <small>{data.validation.independentSignalAudit.definition}</small>
            {data.validation.independentSignalAudit.parameters && (
              <small>
                参数：VIX Fix {data.validation.independentSignalAudit.parameters.vixFix}；
                随机指标 {data.validation.independentSignalAudit.parameters.stochastic}；
                确认窗口 {data.validation.independentSignalAudit.parameters.confirmationWindow}日。
              </small>
            )}
            {data.validation.independentSignalAudit.videoOnly && (
              <small>
                未采用的视频顶部候选卖点命中
                {data.validation.independentSignalAudit.videoOnly.risk.hitRate.toFixed(1)}%
                （{data.validation.independentSignalAudit.videoOnly.risk.signals}次），
                低于第13版，故没有替换。
              </small>
            )}
            {data.validation.independentSignalAudit.hybridBacktest && (
              <div className="hybrid-backtest-summary">
                <span>V12组合长期回测结论</span>
                <p>
                  {data.validation.independentSignalAudit.hybridBacktest.proposed.label}：收益
                  <b>{data.validation.independentSignalAudit.hybridBacktest.proposed.totalReturn.toFixed(2)}%</b>
                  ，最大回撤
                  <b>{data.validation.independentSignalAudit.hybridBacktest.proposed.maxDrawdown.toFixed(2)}%</b>；
                  {data.validation.independentSignalAudit.hybridBacktest.current.label}：收益
                  <b>{data.validation.independentSignalAudit.hybridBacktest.current.totalReturn.toFixed(2)}%</b>
                  ，最大回撤
                  <b>{data.validation.independentSignalAudit.hybridBacktest.current.maxDrawdown.toFixed(2)}%</b>。
                </p>
                <small>
                  近120日V12组合
                  {data.validation.independentSignalAudit.hybridBacktest.recent120.proposedReturn.toFixed(2)}%，
                  当前组合
                  {data.validation.independentSignalAudit.hybridBacktest.recent120.currentReturn.toFixed(2)}%，
                  但只有
                  {data.validation.independentSignalAudit.hybridBacktest.recent120.completedTrades}次完整交易。
                  {data.validation.independentSignalAudit.hybridBacktest.period}；
                  {data.validation.independentSignalAudit.hybridBacktest.execution}。
                </small>
              </div>
            )}
          </div>
        )}
        <p className="audit-note">
          {data?.validation.modelAudit.period || "审计区间加载中"}。
          {data?.validation.modelAudit.assumptions ||
            "审计假设加载中"}
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COMPONENTS</p>
            <h2>七项实时分数</h2>
          </div>
          <button className="coverage" onClick={() => setInfoKey("coverage")}>
            公开数据覆盖 78% <i>i</i>
          </button>
        </div>
        <div className="score-list">
          {Object.entries(scoreNames).map(([key, name]) => {
            const value = data?.scores[key] ?? 0;
            return (
              <div className="score-row" key={key}>
                <div className="score-title-row">
                  <button className="score-info-button" onClick={() => setInfoKey(key)}>
                    <span>{name}</span>
                    <i>i</i>
                  </button>
                  <strong>{data ? value.toFixed(0) : "—"}</strong>
                </div>
                <div className="score-track">
                  <span style={{ width: `${value}%` }} />
                </div>
                <small>{data ? scoreZone(value) : "等待实时行情"}</small>
              </div>
            );
          })}
        </div>
      </section>

      {!isStandalone && (
        <section className="install-card">
          <div>
            <p className="eyebrow">INSTALL ON IPHONE</p>
            <h2>像App一样每天打开</h2>
            <p>
              用Safari打开，点“分享”→“添加到主屏幕”。之后点桌面图标即可自动刷新。
            </p>
          </div>
          <button onClick={() => setInstallTip((value) => !value)}>
            {installTip ? "知道了" : "安装方法"}
          </button>
          {installTip && <div className="tip">Safari底部分享按钮 → 添加到主屏幕 → 添加</div>}
        </section>
      )}

      <footer>
        <p>
          数据来自公开行情接口，盘中每60秒自动刷新。情绪指标用于观察市场结构，不构成投资建议。
        </p>
        <span>{data?.source || "公开行情"}</span>
      </footer>

      {infoKey && (() => {
        const info = getIndicatorInfo(infoKey, data);
        return (
          <div className="info-overlay" role="presentation" onClick={() => setInfoKey(null)}>
            <section
              className="info-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="info-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="info-sheet-head">
                <div>
                  <p className="eyebrow">INDICATOR GUIDE</p>
                  <h2 id="info-title">{info.title}</h2>
                </div>
                <button className="close-button" onClick={() => setInfoKey(null)} aria-label="关闭说明">×</button>
              </div>
              <dl className="info-list">
                <div>
                  <dt>如何计算</dt>
                  <dd>{info.formula}</dd>
                </div>
                <div>
                  <dt>当前数据</dt>
                  <dd>{info.current}</dd>
                </div>
                <div>
                  <dt>当前区间</dt>
                  <dd>{info.zone}</dd>
                </div>
                <div>
                  <dt>代表含义</dt>
                  <dd>{info.meaning}</dd>
                </div>
                <div>
                  <dt>统一分区</dt>
                  <dd>{info.ranges}</dd>
                </div>
              </dl>
              <button className="sheet-done" onClick={() => setInfoKey(null)}>我知道了</button>
            </section>
          </div>
        );
      })()}
    </main>
  );
}
