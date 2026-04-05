import { useState } from "react";
import BankSearch from "./BankSearch";
import { CATEGORY_COLORS, getRatioMeta } from "../../constants/ubprRatios";
import { fmtVal, formatQ, getRegulatoryStatus, exportCSV } from "../../utils/ubprFormatters";
import { fetchUBPRRatios } from "../../services/api";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";
const RED    = "#dc2626";

// Show only these categories in the compare view - keeps it clean
const COMPARE_CATEGORIES = ["Capital", "Profitability", "Liquidity", "Asset Quality"];

// Priority codes per category - show the best available per bank
const CATEGORY_PRIORITY = {
  "Capital":       ["UBPRR031", "UBPRD487", "UBPRD488", "UBPRD486", "UBPR7308"],
  "Profitability": ["UBPRE013", "UBPRE630", "UBPRE018"],
  "Liquidity":     ["UBPRE600", "UBPR7316"],
  "Asset Quality": ["UBPR7414", "UBPRE019"],
};

function Spinner({ size = 14 }) {
  return <div style={{ width: size, height: size, border: `2px solid rgba(255,255,255,0.3)`, borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

export default function MultiCompare({ quarters, banks }) {
  const [rows, setRows]       = useState([{ bank: null, quarter: quarters[0] || "" }]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [activeTab, setActiveTab] = useState("Capital");

  const addRow    = () => setRows(r => [...r, { bank: null, quarter: quarters[0] || "" }]);
  const removeRow = (i) => setRows(r => r.filter((_, idx) => idx !== i));
  const updateRow = (i, patch) => setRows(r => r.map((row, idx) => idx === i ? { ...row, ...patch } : row));

  const runCompare = async () => {
    const valid = rows.filter(r => r.bank && r.quarter);
    if (!valid.length) return;
    setLoading(true); setError(null); setResults([]);
    try {
      const fetched = await Promise.all(
        valid.map(r =>
          fetchUBPRRatios(String(r.bank.ID_RSSD), r.quarter)
            .then(d => ({ label: String(r.bank.Name || "").trim(), rssd: r.bank.ID_RSSD, quarter: r.quarter, ratios: d.ratios || {} }))
            .catch(() => ({ label: String(r.bank.Name || "Unknown").trim(), rssd: null, quarter: r.quarter, ratios: {} }))
        )
      );
      setResults(fetched);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // For the active category, find codes present in at least one result
  const activeCodes = results.length > 0
    ? (CATEGORY_PRIORITY[activeTab] || []).filter(code =>
        results.some(r => r.ratios[code] != null)
      )
    : [];

  const handleExport = () => {
    const allCodes = COMPARE_CATEGORIES.flatMap(cat =>
      (CATEGORY_PRIORITY[cat] || []).filter(code => results.some(r => r.ratios[code] != null))
    );
    exportCSV(
      ["UBPR Code", "Label", "Category", ...results.map(r => `${r.label} (${formatQ(r.quarter)})`)],
      allCodes.map(code => {
        const meta = getRatioMeta(code);
        return [code, meta.label, meta.category, ...results.map(res => fmtVal(res.ratios[code], false))];
      }),
      "bank_comparison.csv"
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Row builder */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Compare Institutions</div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 20 }}>
          Each row is one institution × one period. Best value per ratio is highlighted green, worst red.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 160px 36px", gap: 10, alignItems: "center" }}>
              <BankSearch banks={banks} value={row.bank} onSelect={b => updateRow(i, { bank: b })} placeholder={`Institution ${i + 1}…`} />
              <select value={row.quarter} onChange={e => updateRow(i, { quarter: e.target.value })} style={{ padding: 10, fontSize: 13, border: `1.5px solid ${BORDER}`, borderRadius: 8, background: "#fff" }}>
                {quarters.map(q => <option key={q} value={q}>{formatQ(q)}</option>)}
              </select>
              <button onClick={() => removeRow(i)} disabled={rows.length === 1} style={{ width: 36, height: 36, border: `1px solid ${BORDER}`, borderRadius: 8, background: "#fff", cursor: rows.length === 1 ? "not-allowed" : "pointer", color: "#94a3b8", fontSize: 18, opacity: rows.length === 1 ? 0.4 : 1 }}>×</button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={addRow} style={{ padding: "9px 16px", fontSize: 12, fontWeight: 600, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, cursor: "pointer", color: G }}>+ Add Institution</button>
          <button onClick={runCompare} disabled={loading || !rows.some(r => r.bank)} style={{ padding: "9px 24px", fontSize: 13, fontWeight: 700, background: rows.some(r => r.bank) ? G : "#d4ddd8", color: rows.some(r => r.bank) ? "#fff" : "#8fa89a", border: "none", borderRadius: 8, cursor: rows.some(r => r.bank) ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 8 }}>
            {loading && <Spinner />}{loading ? "Loading…" : "Compare"}
          </button>
        </div>
        {error && <div style={{ marginTop: 12, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 12, color: RED }}>{error}</div>}
      </div>

      {/* Results - categorized tabs */}
      {results.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Comparison Results</div>
            <button onClick={handleExport} style={{ fontSize: 11, fontWeight: 600, color: G, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer" }}>Export All CSV</button>
          </div>

          {/* Category tabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {COMPARE_CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                style={{
                  padding: "7px 16px", borderRadius: 99, fontSize: 12, fontWeight: activeTab === cat ? 700 : 500,
                  background: activeTab === cat ? (CATEGORY_COLORS[cat] || G) : "#fff",
                  color: activeTab === cat ? "#fff" : MUTED,
                  border: `1.5px solid ${activeTab === cat ? (CATEGORY_COLORS[cat] || G) : BORDER}`,
                  cursor: "pointer", transition: "all 0.15s",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Metric cards for active category */}
          {activeCodes.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: MUTED, fontSize: 13 }}>
              No {activeTab} data available for the selected institutions.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeCodes.map(code => {
                const meta  = getRatioMeta(code);
                const nums  = results.map(r => parseFloat(r.ratios[code]));
                const valid = nums.filter(v => !isNaN(v));
                const maxV  = valid.length ? Math.max(...valid) : null;
                const minV  = valid.length ? Math.min(...valid) : null;

                return (
                  <div key={code} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
                    {/* Metric header */}
                    <div style={{ padding: "10px 16px", background: `${CATEGORY_COLORS[activeTab] || G}10`, borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{meta.label}</div>
                      <div style={{ fontSize: 10, color: CATEGORY_COLORS[activeTab] || MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>{meta.category}</div>
                    </div>

                    {/* Bank values */}
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${results.length}, 1fr)` }}>
                      {results.map((r, ci) => {
                        const raw  = r.ratios[code];
                        const n    = parseFloat(raw);
                        const best = !isNaN(n) && n === maxV && valid.length > 1;
                        const worst= !isNaN(n) && n === minV && valid.length > 1 && minV !== maxV;
                        const reg  = getRegulatoryStatus(code, raw);
                        return (
                          <div key={ci} style={{
                            padding: "16px", textAlign: "center",
                            borderRight: ci < results.length - 1 ? `1px solid ${BORDER}` : "none",
                            background: best ? "#f0fdf4" : worst ? "#fef2f2" : "#fff",
                          }}>
                            <div style={{ fontSize: 11, color: MUTED, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {r.label.split(" ").slice(0, 3).join(" ")}
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: best ? GREEN : worst ? RED : TEXT }}>
                              {raw == null ? "-" : fmtVal(raw, false)}
                            </div>
                            <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{formatQ(r.quarter)}</div>
                            {best && <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, marginTop: 4 }}>▲ Best</div>}
                            {worst && <div style={{ fontSize: 10, color: RED, fontWeight: 700, marginTop: 4 }}>▼ Worst</div>}
                            {reg && reg.status !== "healthy" && <div style={{ fontSize: 10, color: reg.color, marginTop: 4 }}>⚠ {reg.label}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}