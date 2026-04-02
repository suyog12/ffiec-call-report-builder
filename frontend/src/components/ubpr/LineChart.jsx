import { useState, useRef } from "react";
import { WM } from "../../theme/colors";

const BORDER = "#e4e9e2";
const MUTED  = "#6b8878";

const MIN_PX_PER_POINT = 60; // minimum width per data point before scrolling kicks in

export default function LineChart({
  data,
  isPercent = false,
  color     = "#115740",
  height    = 160,
  expanded  = false,
  svgRef    = null,
}) {
  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);

  if (!data || data.length < 2) return null;
  const vals = data.map(d => parseFloat(d.value)).filter(v => !isNaN(v));
  if (vals.length < 2) return null;

  const min   = Math.min(...vals);
  const max   = Math.max(...vals);
  const range = max - min || 0.001;

  const PAD = { top: 16, right: 20, bottom: 32, left: 56 };
  const H   = height;

  // Scale width to number of points — scrolls when too many to fit
  const minW  = expanded ? 800 : 400;
  const autoW = Math.max(minW, data.length * MIN_PX_PER_POINT + PAD.left + PAD.right);
  const W     = autoW;

  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  const toX = (i) => PAD.left + (i / (vals.length - 1)) * iW;
  const toY = (v) => PAD.top  + (1 - (v - min) / range) * iH;

  const points = vals.map((v, i) => ({
    x: toX(i), y: toY(v), v,
    q: data[i]?.quarter || "",
    raw_quarter: data[i]?.raw_quarter || "",
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length-1].x.toFixed(1)} ${(PAD.top+iH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(PAD.top+iH).toFixed(1)} Z`;

  const fmt = (v) => isPercent ? (v * 100).toFixed(2) + "%" : v.toFixed(2) + "%";

  const yTicks = [min, min + range * 0.5, max].map(v => ({
    y: toY(v), label: fmt(v),
  }));

  // With scrolling, show every label — no need to skip
  const showXLabel = (i) =>
    data.length <= 12
      ? (i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0)
      : true; // show all when scrolling

  const gradId = `g_${color.replace("#", "")}_${expanded ? "x" : "n"}_${vals.length}`;

  const handleMouseMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left; // no scaleX needed — SVG is not viewBox-scaled in scroll mode
    let closest = 0, minDist = Infinity;
    points.forEach((p, i) => {
      // convert SVG coords to rendered coords
      const rendered = (p.x / W) * rect.width;
      const d = Math.abs(rendered - mx);
      if (d < minDist) { minDist = d; closest = i; }
    });
    setTooltip({ ...points[closest], idx: closest });
  };

  const isScrollable = W > minW;

  return (
    <div style={{ position: "relative" }}>
      {/* Scroll hint */}
      {isScrollable && (
        <div style={{
          fontSize: 10, color: MUTED, textAlign: "right",
          marginBottom: 4, fontStyle: "italic",
        }}>
          ← scroll to see all quarters →
        </div>
      )}

      {/* Scrollable container */}
      <div
        ref={containerRef}
        style={{
          overflowX: isScrollable ? "auto" : "visible",
          overflowY: "visible",
          // Subtle scrollbar styling
          scrollbarWidth: "thin",
          scrollbarColor: `${color}40 transparent`,
        }}
      >
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{
            display: "block",
            minWidth: W,
            cursor: "crosshair",
            overflow: "visible",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={t.y} x2={PAD.left + iW} y2={t.y}
                stroke={BORDER} strokeWidth="1" strokeDasharray="3,3" />
              <text x={PAD.left - 8} y={t.y + 4} textAnchor="end" fontSize="10" fill={MUTED}>{t.label}</text>
            </g>
          ))}

          {/* Area fill */}
          <path d={areaPath} fill={`url(#${gradId})`} />

          {/* Line */}
          <path d={linePath} fill="none" stroke={color} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* Points + x labels */}
          {points.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x} cy={p.y}
                r={tooltip?.idx === i ? 6 : 3.5}
                fill={tooltip?.idx === i ? "#fff" : color}
                stroke={color}
                strokeWidth={tooltip?.idx === i ? 2.5 : 1.5}
              />
              {showXLabel(i) && (
                <text x={p.x} y={PAD.top + iH + 20} textAnchor="middle" fontSize="9" fill={MUTED}>
                  {p.q}
                </text>
              )}
            </g>
          ))}

          {/* Hover crosshair */}
          {tooltip && (
            <line x1={tooltip.x} y1={PAD.top} x2={tooltip.x} y2={PAD.top + iH}
              stroke={color} strokeWidth="1" strokeDasharray="4,3" opacity="0.4" />
          )}
        </svg>
      </div>

      {/* Tooltip — positioned relative to container */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: `${(tooltip.x / W) * 100}%`,
          top: 0,
          transform: tooltip.idx > points.length * 0.6
            ? "translateX(-110%)"
            : "translateX(10%)",
          background: "#1a2e20",
          color: "#fff",
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 12,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
          zIndex: 10,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{fmt(tooltip.v)}</div>
          <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>{tooltip.q}</div>
        </div>
      )}
    </div>
  );
}