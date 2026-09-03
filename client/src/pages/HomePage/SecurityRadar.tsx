"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@lark-apaas/client-toolkit/logger";

import { getSecurityRadarPayload } from "@client/src/api";

type RadarComponent = {
  key: string;
  label: string;
  score: number;
  current: string;
  meaning: string;
};

type RadarInstrument = {
  id: string;
  kind: "index" | "sector" | "stock";
  name: string;
  code: string;
  role: string;
  score: number;
  zone: string;
  state: {
    label: string;
    detail: string;
  };
  price: number | null;
  todayChange: number;
  return20: number;
  volatility: number;
  components: RadarComponent[];
  trend: Array<{
    date: string;
    score: number;
    price: number;
    intraday?: boolean;
    signal?: "add" | "full" | "reduce" | "empty";
    signalLabel?: string;
    signalReason?: string;
    signalStreak?: number;
    level?: 0 | 1 | 2;
    v12Sell?: boolean;
    v12SellLabel?: string;
    v12SellReason?: string;
    sellResonance?: boolean;
  }>;
  positionSignal: {
    code: "add" | "full" | "reduce" | "empty" | "waiting";
    label: string;
    action: string;
    detail: string;
    nextTrigger: string;
    level: 0 | 1 | 2;
  };
  signalValidation: {
    mode: string;
    independent: SignalAccuracy;
    stateful: SignalAccuracy;
    v12Sell?: SignalAccuracy;
    videoOnly?: SignalAccuracy;
    labels?: {
      independent: string;
      stateful: string;
      v12Sell?: string;
    };
    parameters?: {
      vixFix: string;
      stochastic: string;
      confirmationWindow: number;
      execution: string;
    };
  };
  snapshot: {
    label: string;
    value: string;
  };
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

type RadarPayload = {
  live: boolean;
  marketOpen: boolean;
  updatedAt: string;
  instruments: RadarInstrument[];
  methodology: {
    title: string;
    sample: string;
    ranges: string;
    limitation: string;
  };
  members: Array<{ code: string; name: string; role: string }>;
  source: string;
  error?: string;
};

function formatFinite(value: number | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}

function RadarCanvas({ components }: { components: RadarComponent[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || components.length < 3) return;
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
      context.clearRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2 + 4;
      const radius = Math.min(width, height) * 0.31;
      const angleAt = (index: number) =>
        -Math.PI / 2 + (index / components.length) * Math.PI * 2;
      const point = (index: number, scale: number) => ({
        x: centerX + Math.cos(angleAt(index)) * radius * scale,
        y: centerY + Math.sin(angleAt(index)) * radius * scale,
      });

      [0.25, 0.5, 0.75, 1].forEach((scale) => {
        context.beginPath();
        components.forEach((_, index) => {
          const next = point(index, scale);
          if (index === 0) context.moveTo(next.x, next.y);
          else context.lineTo(next.x, next.y);
        });
        context.closePath();
        context.strokeStyle =
          scale === 1 ? "rgba(151,185,194,.25)" : "rgba(151,185,194,.11)";
        context.lineWidth = 1;
        context.stroke();
      });

      components.forEach((component, index) => {
        const outer = point(index, 1);
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(outer.x, outer.y);
        context.strokeStyle = "rgba(151,185,194,.13)";
        context.stroke();
        const label = point(index, 1.27);
        context.fillStyle = "#8fa6ae";
        context.font = "10px -apple-system, PingFang SC";
        context.textAlign =
          Math.abs(label.x - centerX) < 6
            ? "center"
            : label.x > centerX
              ? "left"
              : "right";
        context.textBaseline = "middle";
        context.fillText(component.label, label.x, label.y);
      });

      const gradient = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        radius,
      );
      gradient.addColorStop(0, "rgba(82,213,208,.38)");
      gradient.addColorStop(1, "rgba(82,213,208,.09)");
      context.beginPath();
      components.forEach((component, index) => {
        const next = point(index, component.score / 100);
        if (index === 0) context.moveTo(next.x, next.y);
        else context.lineTo(next.x, next.y);
      });
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
      context.strokeStyle = "#62d8d2";
      context.lineWidth = 2;
      context.shadowColor = "rgba(82,213,208,.35)";
      context.shadowBlur = 8;
      context.stroke();
      context.shadowBlur = 0;

      components.forEach((component, index) => {
        const next = point(index, component.score / 100);
        context.beginPath();
        context.arc(next.x, next.y, 3.2, 0, Math.PI * 2);
        context.fillStyle = component.score >= 70 ? "#f2b84b" : "#62d8d2";
        context.fill();
        context.strokeStyle = "#07131f";
        context.lineWidth = 1.5;
        context.stroke();
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [components]);

  return (
    <canvas
      className="security-radar-canvas"
      ref={canvasRef}
      aria-label="板块或个股七维情绪雷达图"
    />
  );
}

function RadarHistoryChart({
  points,
}: {
  points: RadarInstrument["trend"];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [windowDays, setWindowDays] = useState(60);
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
    visiblePoints.length - 1,
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
      context.clearRect(0, 0, width, height);
      const left = 26;
      const right = 42;
      const top = 10;
      const bottom = 22;
      const chartWidth = width - left - right;
      const chartHeight = height - top - bottom;
      const x = (index: number) =>
        left + (index / Math.max(1, visiblePoints.length - 1)) * chartWidth;
      const y = (score: number) => top + ((100 - score) / 100) * chartHeight;
      const prices = visiblePoints
        .map((point) => point.price)
        .filter(Number.isFinite);
      if (!prices.length) return;
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);
      const pricePadding = Math.max(
        priceMax * 0.005,
        (priceMax - priceMin) * 0.12,
      );
      const priceFloor = priceMin - pricePadding;
      const priceCeiling = priceMax + pricePadding;
      const priceY = (price: number) =>
        top +
        ((priceCeiling - price) /
          Math.max(0.0001, priceCeiling - priceFloor)) *
          chartHeight;

      [
        [0, 40, "rgba(40,196,143,.05)"],
        [40, 60, "rgba(242,184,75,.035)"],
        [60, 100, "rgba(240,92,86,.045)"],
      ].forEach(([from, to, color]) => {
        context.fillStyle = String(color);
        context.fillRect(
          left,
          y(Number(to)),
          chartWidth,
          y(Number(from)) - y(Number(to)),
        );
      });
      [20, 40, 60, 80].forEach((score) => {
        context.beginPath();
        context.moveTo(left, y(score));
        context.lineTo(width - right, y(score));
        context.setLineDash([3, 5]);
        context.strokeStyle = "rgba(151,185,194,.12)";
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = "#607a84";
        context.font = "9px -apple-system, PingFang SC";
        context.textAlign = "right";
        context.fillText(String(score), left - 5, y(score) + 3);
      });

      context.beginPath();
      visiblePoints.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), priceY(point.price));
        else context.lineTo(x(index), priceY(point.price));
      });
      context.strokeStyle = "#8e9bff";
      context.lineWidth = 1.6;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#727da3";
      context.font = "8px -apple-system, PingFang SC";
      context.textAlign = "left";
      context.fillText(priceCeiling.toFixed(1), width - right + 5, top + 3);
      context.fillText(
        priceFloor.toFixed(1),
        width - right + 5,
        height - bottom - 2,
      );

      const gradient = context.createLinearGradient(0, top, 0, height - bottom);
      gradient.addColorStop(0, "rgba(82,213,208,.28)");
      gradient.addColorStop(1, "rgba(82,213,208,0)");
      context.beginPath();
      visiblePoints.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.score));
        else context.lineTo(x(index), y(point.score));
      });
      context.lineTo(x(visiblePoints.length - 1), height - bottom);
      context.lineTo(x(0), height - bottom);
      context.closePath();
      context.fillStyle = gradient;
      context.fill();
      context.beginPath();
      visiblePoints.forEach((point, index) => {
        if (index === 0) context.moveTo(x(index), y(point.score));
        else context.lineTo(x(index), y(point.score));
      });
      context.strokeStyle = "#62d8d2";
      context.lineWidth = 2;
      context.stroke();

      const signalColors = {
        add: "#ef9a68",
        full: "#f05c56",
        reduce: "#f2b84b",
        empty: "#28c48f",
      };
      const signalText = {
        add: "买",
        full: "全",
        reduce: "减",
        empty: "卖",
      };
      visiblePoints.forEach((point, index) => {
        if (!point.signal) return;
        const px = x(index);
        const py = Math.min(
          height - bottom - 12,
          Math.max(top + 12, priceY(point.price)),
        );
        const isBuy = point.signal === "add";
        const isStrong = true;
        context.beginPath();
        if (isBuy) {
          context.moveTo(px, py - 8);
          context.lineTo(px - 6, py + 3);
          context.lineTo(px + 6, py + 3);
        } else {
          context.moveTo(px, py + 8);
          context.lineTo(px - 6, py - 3);
          context.lineTo(px + 6, py - 3);
        }
        context.closePath();
        context.fillStyle = isStrong
          ? signalColors[point.signal]
          : "rgba(7,19,31,.92)";
        context.fill();
        context.strokeStyle = signalColors[point.signal];
        context.lineWidth = isStrong ? 1.5 : 2;
        context.stroke();
        if (point.sellResonance && point.signal === "empty") {
          context.beginPath();
          context.arc(px, py, 10, 0, Math.PI * 2);
          context.strokeStyle = "#f2cf86";
          context.lineWidth = 1.5;
          context.stroke();
        }
        if (visiblePoints.length <= 60) {
          context.fillStyle = signalColors[point.signal];
          context.font = "700 8px -apple-system, PingFang SC";
          context.textAlign = "center";
          context.fillText(
            `${signalText[point.signal]}${
              index === safeActive && (point.signalStreak ?? 0) > 1
                ? point.signalStreak
                : ""
            }`,
            px,
            isBuy ? py - 14 : py + 16,
          );
        }
      });

      if (showV12Sells) {
        visiblePoints.forEach((point, index) => {
          if (!point.v12Sell || point.sellResonance) return;
          const px = x(index);
          const markerY = Math.min(
            height - bottom - 10,
            Math.max(top + 10, priceY(point.price) + 13),
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
        context.strokeStyle = "rgba(236,244,245,.18)";
        context.setLineDash([3, 4]);
        context.beginPath();
        context.moveTo(x(safeActive), top);
        context.lineTo(x(safeActive), height - bottom);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.arc(x(safeActive), y(selected.score), 4, 0, Math.PI * 2);
        context.fillStyle = "#f2b84b";
        context.fill();
        context.strokeStyle = "#07131f";
        context.lineWidth = 1.5;
        context.stroke();
        context.beginPath();
        context.arc(x(safeActive), priceY(selected.price), 3, 0, Math.PI * 2);
        context.fillStyle = "#8e9bff";
        context.fill();
      }
      context.fillStyle = "#68828c";
      context.font = "9px -apple-system, PingFang SC";
      context.textAlign = "left";
      context.fillText(visiblePoints[0].date.slice(5), left, height - 5);
      context.textAlign = "right";
      context.fillText(
        visiblePoints.at(-1)!.date.slice(5),
        width - right,
        height - 5,
      );
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [visiblePoints, safeActive, showV12Sells]);

  const selected = visiblePoints[safeActive];
  const rangeStart = points[Math.max(0, windowDays - 1)]
    ? windowDays - 1
    : 0;
  return (
    <div>
      <div className="chart-controls">
        <div className="chart-control-group">
          <div className="window-buttons" aria-label="选择指数或个股趋势范围">
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
              onChange={(event) =>
                setShowV12Sells(event.currentTarget.checked)
              }
            />
            <span>显示V12卖点</span>
          </label>
        </div>
        <span>
          {visiblePoints[0]?.date.slice(5)} — {visiblePoints.at(-1)?.date.slice(5)}
        </span>
      </div>
      <div className="security-sparkline">
        <canvas
          ref={canvasRef}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const relative = Math.min(
              1,
              Math.max(
                0,
                (event.clientX - bounds.left - 26) /
                  Math.max(1, bounds.width - 68),
              ),
            );
            setActive(
              Math.round(relative * Math.max(0, visiblePoints.length - 1)),
            );
          }}
          onPointerLeave={() => setActive(visiblePoints.length - 1)}
          aria-label={`${visibleCount}个交易日情绪、价格、V15买点、V13主卖点与V12风险卖点曲线`}
        />
        {selected && (
          <span className="security-spark-value">
            {selected.date.slice(5)}
            {selected.intraday ? " · 盘中" : ""} · 情绪
            {formatFinite(selected.score)} · 价格
            {formatFinite(selected.price, 2)}
            {selected.signalLabel ? ` · ${selected.signalLabel}` : ""}
            {showV12Sells && selected.v12Sell
              ? ` · ${selected.v12SellLabel}`
              : ""}
          </span>
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
          aria-label="拖动指数或个股趋势时间范围"
        />
      </label>
      <div className="chart-legend security-history-legend">
        <span><i className="legend-sentiment-line" />情绪（左轴）</span>
        <span><i className="legend-price-line" />价格（右轴）</span>
        <span><i className="legend-add" />买点</span>
        <span><i className="legend-empty" />卖点</span>
        <span><i className="legend-v12" />V12风险提醒</span>
      </div>
    </div>
  );
}

export function SecurityRadar() {
  const [data, setData] = useState<RadarPayload | null>(null);
  const [selectedId, setSelectedId] = useState("pcb");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<RadarComponent | "method" | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getSecurityRadarPayload<RadarPayload>();
      if (!next.live) {
        throw new Error(next.error || "板块行情暂时不可用");
      }
      setData(next);
      setError("");
    } catch (reason) {
      logger.error("指数与板块个股行情刷新失败", reason);
      setError(reason instanceof Error ? reason.message : "板块雷达刷新失败");
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

  const selected =
    data?.instruments.find((instrument) => instrument.id === selectedId) ??
    data?.instruments[0];
  const positive = (selected?.todayChange ?? 0) >= 0;

  return (
    <>
      <section className="panel security-radar-panel">
        <div className="section-heading security-heading">
          <div>
            <p className="eyebrow">INDEX + SECTOR + STOCK RADAR</p>
            <div className="title-with-info">
              <h2>指数、板块与个股情绪雷达</h2>
              <button
                className="info-button"
                onClick={() => setInfo("method")}
                aria-label="查看双确认买卖点方法"
              >
                i
              </button>
            </div>
          </div>
          <button className="radar-refresh" onClick={refresh}>
            {loading ? "计算中" : data?.marketOpen ? "盘中实时" : "最近收盘"}
          </button>
        </div>

        <div className="security-tabs" role="tablist" aria-label="选择指数、板块或个股">
          {(data?.instruments ?? [
            { id: "sh000688", name: "科创50", code: "000688" },
            { id: "pcb", name: "PCB板块", code: "核心样本" },
            { id: "sz002463", name: "沪电股份", code: "002463" },
            { id: "sz300476", name: "胜宏科技", code: "300476" },
            { id: "sz300274", name: "阳光电源", code: "300274" },
          ]).map((instrument) => (
            <button
              key={instrument.id}
              className={selectedId === instrument.id ? "active" : ""}
              onClick={() => setSelectedId(instrument.id)}
              role="tab"
              aria-selected={selectedId === instrument.id}
            >
              <strong>{instrument.name}</strong>
              <span>{instrument.code}</span>
            </button>
          ))}
        </div>

        {error && !selected ? (
          <div className="security-error">
            <strong>暂时未取得指数与PCB行情</strong>
            <span>{error}</span>
            <button onClick={refresh}>重试</button>
          </div>
        ) : selected ? (
          <>
            <div className="security-summary">
              <div>
                <span>
                  {selected.kind === "index"
                    ? "指数综合情绪"
                    : selected.kind === "sector"
                      ? "行业综合情绪"
                      : "个股综合情绪"}
                </span>
                <strong>{selected.score.toFixed(1)}</strong>
                <em>{selected.zone}</em>
              </div>
              <div className="security-quote">
                <span>{selected.role}</span>
                <strong>
                  {selected.price
                    ? `${selected.kind === "stock" ? "¥" : ""}${selected.price.toFixed(2)}`
                    : selected.snapshot.value}
                </strong>
                <b className={positive ? "positive" : "negative"}>
                  {positive ? "+" : ""}
                  {(selected.todayChange * 100).toFixed(2)}% 当日
                </b>
              </div>
            </div>

            <div className={`security-state security-signal-${selected.positionSignal.code}`}>
              <span>当前双确认状态</span>
              <strong>{selected.positionSignal.label}</strong>
              <p>
                {selected.positionSignal.action}。{selected.positionSignal.detail}
                <small>下一触发：{selected.positionSignal.nextTrigger}</small>
              </p>
            </div>

            <div className="security-radar-layout">
              <RadarCanvas components={selected.components} />
              <div className="security-metrics">
                <article>
                  <span>20日变化</span>
                  <strong className={selected.return20 >= 0 ? "positive" : "negative"}>
                    {selected.return20 >= 0 ? "+" : ""}
                    {(selected.return20 * 100).toFixed(2)}%
                  </strong>
                </article>
                <article>
                  <span>20日年化波动</span>
                  <strong>{(selected.volatility * 100).toFixed(1)}%</strong>
                </article>
                <article>
                  <span>{selected.snapshot.label}</span>
                  <strong>{selected.snapshot.value}</strong>
                </article>
              </div>
            </div>

            <div className="security-component-list">
              {selected.components.map((component) => (
                <button
                  key={component.key}
                  onClick={() => setInfo(component)}
                  aria-label={`查看${component.label}含义`}
                >
                  <span>
                    <b>{component.label}</b>
                    <i>i</i>
                  </span>
                  <strong>{component.score.toFixed(0)}</strong>
                  <em>
                    <i style={{ width: `${component.score}%` }} />
                  </em>
                  <small>{component.current}</small>
                </button>
              ))}
            </div>

            <div className="security-history">
              <div>
                <span>可查看30 / 60 / 120个交易日</span>
                <strong>情绪＋价格＋V15/V13/V12买卖点</strong>
              </div>
              <RadarHistoryChart points={selected.trend} />
              <div className="security-signal-audit">
                <span>近180日 · 与第13版同口径比较</span>
                <p>
                  V15：买点
                  <b>{selected.signalValidation.independent.buy.hitRate.toFixed(1)}%</b>
                  （{selected.signalValidation.independent.buy.signals}次），卖点
                  <b>{selected.signalValidation.independent.risk.hitRate.toFixed(1)}%</b>
                  （{selected.signalValidation.independent.risk.signals}次）
                </p>
                <p>
                  第13版：买入类
                  <b>{selected.signalValidation.stateful.buy.hitRate.toFixed(1)}%</b>
                  ，风险类
                  <b>{selected.signalValidation.stateful.risk.hitRate.toFixed(1)}%</b>
                </p>
                {selected.signalValidation.v12Sell && (
                  <p>
                    V12卖点：风险方向命中
                    <b>
                      {selected.signalValidation.v12Sell.risk.hitRate.toFixed(1)}%
                    </b>
                    （{selected.signalValidation.v12Sell.risk.signals}次）
                  </p>
                )}
                <small>
                  风险捕捉率
                  {selected.signalValidation.independent.risk.drawdownCaptureRate.toFixed(1)}%
                  ：信号后10日内最大跌幅达到
                  {selected.signalValidation.independent.risk.drawdownThreshold.toFixed(0)}%。
                  每个VIX Fix波动峰只确认一次；样本较少，不能把命中率视为未来胜率。
                </small>
                {selected.signalValidation.videoOnly && (
                  <small>
                    视频顶部候选卖点命中
                    {selected.signalValidation.videoOnly.risk.hitRate.toFixed(1)}%
                    ，未高于第13版，因此没有替换实际卖点。
                  </small>
                )}
              </div>
            </div>
            <p className="security-note">
              科创50使用000688独立行情；PCB为15只核心样本等权；个股同时参考自身、相对PCB、量价、波动、板块和大盘环境。
              买点要求底部VIX Fix峰值与随机指标超卖金叉双确认；主卖点沿用第13版空仓级强风险过滤，V12卖点作为独立短线风险提醒。
              所有买卖点都标在价格线上；视频顶部候选仍参与审计，但不直接画成卖点。
            </p>
          </>
        ) : (
          <div className="chart-loading" />
        )}
      </section>

      {info && (
        <div className="info-overlay" role="presentation" onClick={() => setInfo(null)}>
          <section
            className="info-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-info-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="info-sheet-head">
              <div>
                <p className="eyebrow">RADAR GUIDE</p>
                <h2 id="security-info-title">
                  {info === "method" ? data?.methodology.title : info.label}
                </h2>
              </div>
              <button
                className="close-button"
                onClick={() => setInfo(null)}
                aria-label="关闭说明"
              >
                ×
              </button>
            </div>
            {info === "method" ? (
              <dl className="info-list">
                <div>
                  <dt>样本口径</dt>
                  <dd>{data?.methodology.sample}</dd>
                </div>
                <div>
                  <dt>统一分区</dt>
                  <dd>{data?.methodology.ranges}</dd>
                </div>
                <div>
                  <dt>当前限制</dt>
                  <dd>{data?.methodology.limitation}</dd>
                </div>
                <div>
                  <dt>公开数据源</dt>
                  <dd>{data?.source}</dd>
                </div>
              </dl>
            ) : (
              <dl className="info-list">
                <div>
                  <dt>当前分数</dt>
                  <dd>
                    {info.score.toFixed(1)}分；{info.current}
                  </dd>
                </div>
                <div>
                  <dt>指标含义</dt>
                  <dd>{info.meaning}</dd>
                </div>
                <div>
                  <dt>如何使用</dt>
                  <dd>
                    与其他六项以及近60日趋势一起看。任何单项高分都不能单独构成补仓或全仓依据。
                  </dd>
                </div>
              </dl>
            )}
            <button className="sheet-done" onClick={() => setInfo(null)}>
              我知道了
            </button>
          </section>
        </div>
      )}
    </>
  );
}
