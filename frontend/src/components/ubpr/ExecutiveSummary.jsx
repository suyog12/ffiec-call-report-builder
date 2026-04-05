import RatioCard from "./RatioCard";
import { CATEGORY_COLORS, getRatioMeta } from "../../constants/ubprRatios";
import { fmtVal, fmtMoney, formatQ, getRegulatoryStatus } from "../../utils/ubprFormatters";
import { exportCSV, buildTrendByKey } from "../../utils/ubprFormatters";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";
const RED    = "#dc2626";
const GOLD   = WM.gold;

// The 10 priority groups - one code per group, first available wins
const PRIORITY_GROUPS = [
  { codes: ["UBPRR031", "UBPRD487", "UBPR7400"], fallback: "Tier 1 Capital Ratio" },
  { codes: ["UBPRD488", "UBPRR033"],             fallback: "Total Capital Ratio"  },
  { codes: ["UBPRD486", "UBPR7408"],             fallback: "Leverage Ratio"       },
  { codes: ["UBPR7308"],                         fallback: "Equity to Assets"     },
  { codes: ["UBPRE013", "UBPRE012"],             fallback: "Return on Assets"     },
  { codes: ["UBPRE630"],                         fallback: "Return on Equity"     },
  { codes: ["UBPRE018", "UBPRE003"],             fallback: "Net Interest Margin"  },
  { codes: ["UBPRE600", "UBPR7316"],             fallback: "Loan to Deposit"      },
  { codes: ["UBPR7414"],                         fallback: "Non-Performing Loans" },
  { codes: ["UBPRE019"],                         fallback: "Net Charge-Off Rate"  },
];

function pickTop10(ratios) {
  const available = new Set(Object.keys(ratios));
  return PRIORITY_GROUPS
    .map(g => g.codes.find(c => available.has(c)))
    .filter(Boolean);
}

export default function ExecutiveSummary({ bank, quarter, ratioData, trendData, peerData, onRatioClick }) {
  const rawRatios  = ratioData?.ratios || {};
  const peerAvgs   = peerData?.peer_averages || {};
  const trendByKey = buildTrendByKey(trendData);
  const bankName   = String(bank?.Name || "").trim();

  const top10    = pickTop10(rawRatios);
  const categories = [...new Set(top10.map(c => getRatioMeta(c).category))];

  const alerts = top10.filter(code => {
    const status = getRegulatoryStatus(code, rawRatios[code]);
    return status && status.status !== "healthy";
  });

  const handleExport = () => exportCSV(
    ["UBPR Code", "Label", "Category", "Value", "QoQ Change (pp)", "vs Peers (pp)", "Regulatory Status"],
    top10.map(code => {
      const meta = getRatioMeta(code);
      const td   = trendByKey[code] || [];
      const vals = td.map(p => parseFloat(p.value)).filter(v => !isNaN(v));
      const chg  = vals.length >= 2 ? (vals[0] - vals[1]).toFixed(2) : "-";
      const n    = parseFloat(rawRatios[code]);
      const pn   = parseFloat(peerAvgs[code]);
      const vsp  = !isNaN(n) && !isNaN(pn) ? (n - pn).toFixed(2) : "-";
      const reg  = getRegulatoryStatus(code, rawRatios[code]);
      return [code, meta.label, meta.category, fmtVal(rawRatios[code], false), chg, vsp, reg?.label || "N/A"];
    }),
    `${bankName}_${formatQ(quarter)}_summary.csv`
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Institution header */}
      <div style={{ background: G, borderRadius: 14, padding: "24px 28px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 }}>Institution Analysis</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{bankName}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              RSSD {bank?.ID_RSSD}{bank?.City ? ` · ${bank.City}` : ""}{bank?.State ? `, ${bank.State}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Reporting Period</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatQ(quarter)}</div>
          </div>
        </div>
      </div>

      {/* Regulatory alerts */}
      {alerts.length > 0 && (
        <div style={{ background: "#fef2f2", border: `1px solid ${RED}30`, borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: RED, marginBottom: 10 }}>
            ⚠ {alerts.length} ratio{alerts.length > 1 ? "s" : ""} below regulatory threshold
          </div>
          {alerts.map(code => {
            const meta   = getRatioMeta(code);
            const status = getRegulatoryStatus(code, rawRatios[code]);
            return (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginBottom: 4, flexWrap: "wrap" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
                <strong style={{ color: TEXT }}>{meta.label}</strong>
                <span style={{ color: status.color, fontWeight: 700 }}>{fmtVal(rawRatios[code], false)}</span>
                <span style={{ color: MUTED }}>{status.label} - {status.note}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 10 ratio cards grouped by category */}
      {categories.map(cat => (
        <div key={cat}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: CATEGORY_COLORS[cat] || G, marginBottom: 12 }}>
            {cat}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {top10.filter(code => getRatioMeta(code).category === cat).map(code => {
              const meta = getRatioMeta(code);
              const td   = trendByKey[code] || [];
              return (
                <RatioCard
                  key={code}
                  ratio={{ key: code, label: meta.label, category: meta.category, higherBetter: meta.higherBetter, isPercent: false }}
                  value={rawRatios[code]}
                  trendData={td}
                  peerAvg={peerAvgs[code]}
                  onClick={() => onRatioClick({ ratio: { key: code, label: meta.label, category: meta.category, isPercent: false }, trendData: td })}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Peer comparison table */}
      {Object.keys(peerAvgs).length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Peer Group Comparison</div>
              <div style={{ fontSize: 12, color: MUTED }}>{bankName} vs. All Commercial Banks · {formatQ(quarter)}</div>
            </div>
            <button onClick={handleExport} style={{ fontSize: 11, fontWeight: 600, color: G, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer" }}>
              Export CSV
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 100px", padding: "8px 14px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: MUTED, borderBottom: `2px solid ${BORDER}` }}>
            <div>Ratio</div>
            <div style={{ textAlign: "right" }}>This Bank</div>
            <div style={{ textAlign: "right" }}>Peer Avg</div>
            <div style={{ textAlign: "right" }}>Difference</div>
            <div style={{ textAlign: "center" }}>Position</div>
          </div>

          {Object.keys(peerAvgs).map((code, i) => {
            const meta = getRatioMeta(code);
            const bv   = rawRatios[code];
            const pv   = peerAvgs[code];
            const bn   = parseFloat(bv);
            const pn   = parseFloat(pv);
            const diff = !isNaN(bn) && !isNaN(pn) ? bn - pn : null;
            const good = diff === null ? null : (meta.higherBetter ? diff >= 0 : diff <= 0);
            const reg  = getRegulatoryStatus(code, bv);
            return (
              <div key={code} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 100px", padding: "12px 14px", borderBottom: `1px solid ${BORDER}`, background: i % 2 === 0 ? "#fff" : BG, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{meta.label}</div>
                  <div style={{ fontSize: 10, color: CATEGORY_COLORS[meta.category] || MUTED }}>{meta.category}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{fmtVal(bv, false)}</div>
                  {reg && reg.status !== "healthy" && <div style={{ fontSize: 10, color: reg.color, fontWeight: 600 }}>⚠ {reg.label}</div>}
                </div>
                <div style={{ fontSize: 13, color: MUTED, textAlign: "right" }}>{fmtVal(pv, false)}</div>
                <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: diff === null ? MUTED : good ? GREEN : RED }}>
                  {diff === null ? "-" : `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}pp`}
                </div>
                <div style={{ textAlign: "center" }}>
                  {good !== null && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: good ? GREEN : RED, background: good ? "#f0fdf4" : "#fef2f2", padding: "3px 10px", borderRadius: 99 }}>
                      {good ? "▲ Above" : "▼ Below"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}