import LineChart from "./LineChart";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { CATEGORY_COLORS, getRatioMeta, RULE_CHANGES, ALL_RATIO_CODES } from "../../constants/ubprRatios";
import { fmtVal, formatQ, exportCSV, buildTrendByKey } from "../../utils/ubprFormatters";
import { fetchUBPRTrend } from "../../services/api";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";

function downloadSVG(svgEl, filename) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename + ".svg"; a.click();
  URL.revokeObjectURL(url);
}

function TrendSpinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", justifyContent: "center" }}>
      <div style={{ width: 18, height: 18, border: `2px solid ${BORDER}`, borderTopColor: G, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <span style={{ fontSize: 12, color: MUTED }}>Fetching trend data…</span>
    </div>
  );
}

function buildCategoryMap() {
  const m = {};
  (ALL_RATIO_CODES || []).forEach(code => {
    const meta = getRatioMeta(code);
    if (!meta?.label || meta.label === code) return;
    if (!m[meta.category]) m[meta.category] = [];
    m[meta.category].push({ code, label: meta.label });
  });
  return m;
}

export default function PerformanceTrends({
  bank,
  quarters = [],
  banks,
  trendOverride,           // { metricCode, fromQuarter, toQuarter } — set by chatbot
  onTrendOverrideConsumed, // called after override is applied so parent can clear it
}) {
  const bankName = String(bank?.Name || "").trim();
  const allQuarters = quarters;

  const defaultTo   = allQuarters[0] || "";
  const defaultFrom = allQuarters[Math.min(7, allQuarters.length - 1)] || "";

  const [fromQ, setFromQ]         = useState(defaultFrom);
  const [toQ, setToQ]             = useState(defaultTo);
  const [selected, setSelected]   = useState(new Set());
  const [openCats, setOpenCats]   = useState(new Set());
  const [expanded, setExpanded]   = useState(null);
  const [chartData, setChartData] = useState({});

  const svgRefs = useRef({});
  const categoryMap = useMemo(() => buildCategoryMap(), []);
  const categories  = Object.keys(categoryMap).sort();
  const selectedList = [...selected];
  const [qStart, qEnd] = fromQ < toQ ? [fromQ, toQ] : [toQ, fromQ];
  const selectedQuarterCount = allQuarters.filter(q => q >= qStart && q <= qEnd).length;

  const toggleCat  = (cat)  => setOpenCats(prev => { const s = new Set(prev); s.has(cat)  ? s.delete(cat)  : s.add(cat);  return s; });
  const toggleCode = (code) => setSelected(prev  => { const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s; });

  const fetchCodesData = useCallback(async (codes, from, to) => {
    if (!bank?.ID_RSSD || !codes.length || !from || !to) return;
    const rssdId = String(bank.ID_RSSD);
    const start  = from < to ? from : to;
    const end    = from < to ? to   : from;

    setChartData(prev => {
      const next = { ...prev };
      codes.forEach(code => { next[code] = { ...(prev[code] || {}), loading: true, error: null }; });
      return next;
    });

    try {
      const response = await fetchUBPRTrend(rssdId, start, end, codes);
      const byKey = buildTrendByKey(response);
      setChartData(prev => {
        const next = { ...prev };
        codes.forEach(code => { next[code] = { loading: false, error: null, points: byKey[code] || [] }; });
        return next;
      });
    } catch (e) {
      setChartData(prev => {
        const next = { ...prev };
        codes.forEach(code => { next[code] = { loading: false, error: e.message || "Fetch failed", points: [] }; });
        return next;
      });
    }
  }, [bank?.ID_RSSD]);

  // ── Apply trendOverride from chatbot ──────────────────────────────────────
  useEffect(() => {
    if (!trendOverride) return;
    const { metricCode, fromQuarter, toQuarter } = trendOverride;

    if (fromQuarter) setFromQ(fromQuarter);
    if (toQuarter)   setToQ(toQuarter);

    if (metricCode) {
      setSelected(new Set([metricCode]));

      // Auto-open the category that contains this metric
      const meta = getRatioMeta(metricCode);
      if (meta?.category) {
        setOpenCats(new Set([meta.category]));
      }

      // Fetch immediately with the override range
      const from = fromQuarter || fromQ;
      const to   = toQuarter   || toQ;
      fetchCodesData([metricCode], from, to);
    }

    onTrendOverrideConsumed?.();
  }, [trendOverride]);

  // When user selects a new code
  const prevSelected = useRef(new Set());
  useEffect(() => {
    const added = [...selected].filter(c => !prevSelected.current.has(c));
    prevSelected.current = new Set(selected);
    if (added.length > 0) fetchCodesData(added, fromQ, toQ);
  }, [selected]);

  // When quarter range changes
  useEffect(() => {
    if (!selected.size) return;
    const timer = setTimeout(() => { fetchCodesData([...selected], fromQ, toQ); }, 400);
    return () => clearTimeout(timer);
  }, [fromQ, toQ]);

  // When bank changes
  useEffect(() => {
    setChartData({});
    setSelected(new Set());
    prevSelected.current = new Set();
  }, [bank?.ID_RSSD]);

  const handleExportCSV = () => {
    const qs = allQuarters.filter(q => q >= qStart && q <= qEnd).reverse();
    exportCSV(
      ["Quarter", ...selectedList.map(c => getRatioMeta(c).label)],
      qs.map(q => [
        formatQ(q),
        ...selectedList.map(code => {
          const pts = chartData[code]?.points || [];
          const pt  = pts.find(p => p.raw_quarter === q);
          return pt ? parseFloat(pt.value).toFixed(2) + "%" : "-";
        }),
      ]),
      `${bankName.slice(0, 20)}_trends.csv`
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Green header */}
      <div style={{ background: G, borderRadius: 14, padding: "20px 28px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 4 }}>Performance Trends</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{bankName || "No bank selected"}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              RSSD {bank?.ID_RSSD}{bank?.City ? ` · ${bank.City}` : ""}{bank?.State ? `, ${bank.State}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase", letterSpacing: 1 }}>Quarter Range</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select value={fromQ} onChange={e => setFromQ(e.target.value)} style={{
                padding: "6px 10px", fontSize: 12, borderRadius: 7, border: "none",
                background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer", outline: "none",
              }}>
                {allQuarters.slice().reverse().map(q => (
                  <option key={q} value={q} style={{ color: TEXT, background: "#fff" }}>{formatQ(q)}</option>
                ))}
              </select>
              <span style={{ opacity: 0.7, fontSize: 12 }}>→</span>
              <select value={toQ} onChange={e => setToQ(e.target.value)} style={{
                padding: "6px 10px", fontSize: 12, borderRadius: 7, border: "none",
                background: "rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer", outline: "none",
              }}>
                {allQuarters.map(q => (
                  <option key={q} value={q} style={{ color: TEXT, background: "#fff" }}>{formatQ(q)}</option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>
              {`${selectedQuarterCount} quarters · ${allQuarters.length} available`}
            </div>
          </div>
        </div>
      </div>

      {/* Ratio selector */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 2 }}>Select Ratios to Chart</div>
            <div style={{ fontSize: 11, color: MUTED }}>Open a category and select one or more ratios</div>
          </div>
          {selected.size > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setSelected(new Set())} style={{ padding: "5px 12px", fontSize: 11, color: MUTED, background: BG, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer" }}>
                Clear all ({selected.size})
              </button>
              <button onClick={handleExportCSV} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, color: G, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer" }}>
                Export CSV
              </button>
            </div>
          )}
        </div>

        {categories.length === 0 ? (
          <div style={{ fontSize: 12, color: MUTED, padding: "20px 0", textAlign: "center" }}>Load a bank first.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {categories.map(cat => {
              const catColor = CATEGORY_COLORS[cat] || G;
              const isOpen   = openCats.has(cat);
              const catCount = categoryMap[cat].filter(r => selected.has(r.code)).length;
              return (
                <div key={cat} style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
                  <button onClick={() => toggleCat(cat)} style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "11px 16px", background: isOpen ? `${catColor}0d` : "#fff",
                    border: "none", cursor: "pointer",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: catColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{cat}</span>
                      {catCount > 0 && (
                        <span style={{ background: catColor, color: "#fff", borderRadius: 99, fontSize: 10, padding: "1px 8px", fontWeight: 700 }}>
                          {catCount} selected
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: MUTED }}>{categoryMap[cat].length} ratios</span>
                      <span style={{ fontSize: 12, color: MUTED }}>{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${BORDER}`, background: "#fafcfa" }}>
                      {categoryMap[cat].map((r, i) => {
                        const active = selected.has(r.code);
                        return (
                          <button key={r.code} onClick={() => toggleCode(r.code)} style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 12,
                            padding: "10px 16px", background: active ? `${catColor}0d` : "transparent",
                            border: "none",
                            borderBottom: i < categoryMap[cat].length - 1 ? `1px solid ${BORDER}` : "none",
                            cursor: "pointer", textAlign: "left",
                          }}>
                            <div style={{
                              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                              border: `2px solid ${active ? catColor : "#c8d5cc"}`,
                              background: active ? catColor : "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {active && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: 13, color: active ? TEXT : "#4a6860", fontWeight: active ? 600 : 400 }}>
                              {r.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Charts */}
      {selectedList.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: 48, textAlign: "center", color: MUTED, fontSize: 13, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
          Open a category above and select ratios to view charts.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: selectedList.length === 1 ? "1fr" : "repeat(auto-fill, minmax(440px, 1fr))", gap: 16 }}>
          {selectedList.map(code => {
            const meta       = getRatioMeta(code);
            const catColor   = CATEGORY_COLORS[meta.category] || G;
            const codeState  = chartData[code] || { loading: false, error: null, points: [] };
            const points     = codeState.points || [];
            const isExpanded = expanded === code;
            const latest     = parseFloat(points[points.length - 1]?.value);
            const prev       = parseFloat(points[points.length - 2]?.value);
            const change     = !isNaN(latest) && !isNaN(prev) ? latest - prev : null;
            const good       = change === null ? null : (meta.higherBetter ? change >= 0 : change <= 0);

            return (
              <div key={code} style={{
                background: "#fff", borderRadius: 12, padding: 20,
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                gridColumn: isExpanded ? "1 / -1" : undefined,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 10, color: catColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{meta.category}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{meta.label}</div>
                    {points.length >= 1 && (
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
                        <span>{points.length} qtrs</span>
                        <strong style={{ color: TEXT }}>{fmtVal(points[points.length - 1]?.value, false)}</strong>
                        {change !== null && (
                          <span style={{ color: good ? "#16a34a" : "#dc2626" }}>
                            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}pp QoQ
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { const el = svgRefs.current[code]; if (el) downloadSVG(el, `${bankName.slice(0,15)}_${meta.label.slice(0,20)}`); }}
                      style={{ padding: "5px 9px", fontSize: 11, color: MUTED, background: BG, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer" }}>
                      ↓ SVG
                    </button>
                    <button onClick={() => setExpanded(isExpanded ? null : code)}
                      style={{ padding: "5px 9px", fontSize: 13, color: isExpanded ? G : MUTED, background: isExpanded ? `${G}12` : BG, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer" }}>
                      {isExpanded ? "⊡" : "⊞"}
                    </button>
                    <button onClick={() => toggleCode(code)}
                      style={{ padding: "5px 9px", fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer" }}>
                      ×
                    </button>
                  </div>
                </div>

                {codeState.loading ? <TrendSpinner /> : codeState.error ? (
                  <div style={{ padding: "12px", fontSize: 12, color: "#dc2626", background: "#fef2f2", borderRadius: 8 }}>{codeState.error}</div>
                ) : points.length < 2 ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: MUTED, fontSize: 12 }}>Not enough data in selected range.</div>
                ) : (
                  <LineChart
                    data={points}
                    isPercent={false}
                    color={catColor}
                    height={isExpanded ? 340 : 190}
                    expanded={isExpanded}
                    svgRef={el => { svgRefs.current[code] = el; }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}