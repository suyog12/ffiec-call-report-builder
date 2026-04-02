import { CATEGORY_COLORS, getRatioMeta } from "../../constants/ubprRatios";
import { fmtVal, getRegulatoryStatus } from "../../utils/ubprFormatters";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";
const RED    = "#dc2626";
const GOLD   = WM.gold;

export default function RatioCard({ ratio, value, trendData, peerAvg, onClick }) {
  const vals     = (trendData || []).map(p => parseFloat(p.value)).filter(v => !isNaN(v));
  const change   = vals.length >= 2 ? vals[0] - vals[1] : null;
  const up       = change !== null ? change >= 0 : null;
  const good     = up === null ? null : (ratio.higherBetter ? up : !up);

  const n        = parseFloat(value);
  const peerN    = parseFloat(peerAvg);
  const vsPeer   = !isNaN(n) && !isNaN(peerN) ? n - peerN : null;
  const peerGood = vsPeer === null ? null : (ratio.higherBetter ? vsPeer >= 0 : vsPeer <= 0);

  const regStatus = getRegulatoryStatus(ratio.key, value);
  const catColor  = CATEGORY_COLORS[ratio.category] || G;

  // Mini sparkline — last 4 quarters in chronological order
  const sparkVals = vals.slice(0, 4).reverse();
  const sparkMin  = Math.min(...sparkVals);
  const sparkMax  = Math.max(...sparkVals);
  const sparkR    = sparkMax - sparkMin || 0.001;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick?.()}
      aria-label={`${ratio.label}: ${fmtVal(value, ratio.isPercent)}. Click for details.`}
      style={{
        background: "#fff", borderRadius: 12, padding: "18px 20px",
        borderLeft: `4px solid ${catColor}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        cursor: "pointer", transition: "all 0.15s", position: "relative",
        userSelect: "none",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = `0 4px 20px ${catColor}20`;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Category label */}
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: catColor, marginBottom: 4 }}>
        {ratio.category}
      </div>

      {/* Ratio name */}
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, lineHeight: 1.3, minHeight: 30 }}>
        {ratio.label}
      </div>

      {/* Main value */}
      <div style={{ fontSize: 26, fontWeight: 800, color: TEXT, letterSpacing: "-0.5px", marginBottom: 6 }}>
        {fmtVal(value, ratio.isPercent)}
      </div>

      {/* QoQ change */}
      {change !== null && (
        <div style={{ fontSize: 11, fontWeight: 600, color: good ? GREEN : RED, marginBottom: 4 }}>
          {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)}pp QoQ
        </div>
      )}

      {/* Vs peer */}
      {vsPeer !== null && (
        <div style={{ fontSize: 11, color: peerGood ? GREEN : RED, marginBottom: 8 }}>
          {peerGood ? "▲" : "▼"} {Math.abs(vsPeer).toFixed(2)}pp vs peers
        </div>
      )}

      {/* Regulatory alert badge — only shown when not healthy */}
      {regStatus && regStatus.status !== "healthy" && (
        <div style={{
          display: "inline-block", fontSize: 10, fontWeight: 700,
          color: regStatus.color,
          background: regStatus.color + "18",
          padding: "2px 8px", borderRadius: 99, marginBottom: 8,
        }}>
          ⚠ {regStatus.label}
        </div>
      )}

      {/* Mini sparkline */}
      {sparkVals.length >= 2 && (
        <svg width="100%" height="28" aria-hidden="true" style={{ display: "block", marginTop: 4 }}>
          {sparkVals.map((v, i) => {
            if (i >= sparkVals.length - 1) return null;
            const x1 = `${(i       / (sparkVals.length - 1)) * 100}%`;
            const x2 = `${((i + 1) / (sparkVals.length - 1)) * 100}%`;
            const y1 = 25 - ((v               - sparkMin) / sparkR) * 20;
            const y2 = 25 - ((sparkVals[i + 1] - sparkMin) / sparkR) * 20;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={catColor} strokeWidth="1.5" strokeLinecap="round" />;
          })}
        </svg>
      )}

      {/* Drill-in hint */}
      <div style={{ position: "absolute", top: 12, right: 14, fontSize: 10, color: "#c4d4cb" }}>
        details →
      </div>
    </div>
  );
}