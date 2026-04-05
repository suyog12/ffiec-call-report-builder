import LineChart from "./LineChart";
import { CATEGORY_COLORS, getRatioMeta } from "../../constants/ubprRatios";
import { fmtPct, formatQ, getRegulatoryStatus, getRuleChangeWarning, exportCSV } from "../../utils/ubprFormatters";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";
const RED    = "#dc2626";
const GOLD   = WM.gold;

export default function DrillDownModal({ ratio, trendData, bankName, loading = false, onClose }) {
  const points  = trendData || [];
  const vals    = points.map(p => parseFloat(p.value)).filter(v => !isNaN(v));
  const latest  = vals[vals.length - 1];       // newest = last (sorted ascending)
  const prev    = vals[vals.length - 2];
  const change  = latest !== undefined && prev !== undefined ? latest - prev : null;
  const up      = change !== null ? change >= 0 : null;
  const good    = up === null ? null : (ratio.higherBetter ? up : !up);

  const regStatus = getRegulatoryStatus(ratio.key, latest);
  const latestQ   = points[points.length - 1]?.raw_quarter || points[points.length - 1]?.quarter;
  const oldestQ   = points[0]?.raw_quarter || points[0]?.quarter;
  const ruleWarn  = getRuleChangeWarning(oldestQ, latestQ);
  const catColor  = CATEGORY_COLORS[ratio.category] || "#115740";

  const handleExport = () => exportCSV(
    ["Quarter", "Raw Value", "Formatted"],
    points.map(p => [p.quarter, p.value, fmtPct(p.value)]),
    `${ratio.key}_${bankName || "bank"}_trend.csv`
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${ratio.label} details`}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, padding: 32,
          width: 620, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: catColor, marginBottom: 6 }}>
              {ratio.category} · {ratio.key}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: TEXT }}>{ratio.label}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6, maxWidth: 460, lineHeight: 1.5 }}>{ratio.desc}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94a3b8", lineHeight: 1, padding: "4px 8px", marginLeft: 16 }}
          >
            ×
          </button>
        </div>

        {/* Loading state */}
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "48px 0", color: MUTED, fontSize: 13 }}>
            <div style={{ width: 18, height: 18, border: `2px solid ${BORDER}`, borderTopColor: G, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
            Fetching trend data…
          </div>
        ) : (
          <>
            {/* KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: regStatus ? "1fr 1fr 1fr" : "1fr 1fr", gap: 12, marginBottom: 24 }}>
              <div style={{ padding: "16px 18px", background: BG, borderRadius: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6, textTransform: "uppercase" }}>Latest Value</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: TEXT }}>{latest !== undefined ? fmtPct(latest) : "-"}</div>
                {latestQ && <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{typeof latestQ === "string" && latestQ.length === 8 ? formatQ(latestQ) : latestQ}</div>}
              </div>

              {change !== null && (
                <div style={{ padding: "16px 18px", background: good ? "#f0fdf4" : "#fef2f2", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6, textTransform: "uppercase" }}>QoQ Change</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: good ? GREEN : RED }}>
                    {change >= 0 ? "+" : ""}{change.toFixed(2)}pp
                  </div>
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>vs prior quarter</div>
                </div>
              )}

              {regStatus && (
                <div style={{ padding: "16px 18px", background: regStatus.color + "15", borderRadius: 10, border: `1px solid ${regStatus.color}30` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6, textTransform: "uppercase" }}>Regulatory</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: regStatus.color }}>{regStatus.label}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>{regStatus.note}</div>
                </div>
              )}
            </div>

            {/* Line chart */}
            {points.length >= 2 ? (
              <div style={{ marginBottom: 20 }}>
                <LineChart
                  data={points}
                  label="Historical Trend"
                  isPercent={ratio.isPercent}
                  color={catColor}
                  height={150}
                />
              </div>
            ) : (
              <div style={{ padding: "24px 0", textAlign: "center", color: MUTED, fontSize: 12, marginBottom: 20 }}>
                Not enough data points to render a chart.
              </div>
            )}

            {/* Rule change warning */}
            {ruleWarn && (
              <div style={{
                padding: "12px 16px", background: "#fffbeb", borderRadius: 8,
                borderLeft: `3px solid ${GOLD}`, fontSize: 12, color: "#78540a", marginBottom: 20, lineHeight: 1.5,
              }}>
                <strong>⚠ {ruleWarn.label} ({ruleWarn.date.slice(0, 4)})</strong>
                <div style={{ marginTop: 4 }}>{ruleWarn.detail}</div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${BORDER}`, paddingTop: 16, marginTop: loading ? 0 : 4 }}>
          <div style={{ fontSize: 11, color: MUTED }}>
            {loading ? "Loading…" : `${points.length} quarters of data · ${bankName}`}
          </div>
          <button
            onClick={handleExport}
            disabled={loading || points.length === 0}
            style={{
              fontSize: 11, fontWeight: 600, color: "#115740",
              background: "#fff", border: `1px solid ${BORDER}`,
              borderRadius: 6, padding: "7px 16px", cursor: "pointer",
              opacity: loading || points.length === 0 ? 0.4 : 1,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>
    </div>
  );
}