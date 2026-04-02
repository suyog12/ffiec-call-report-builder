import { useState, useEffect, useCallback } from "react";
import {
  fetchUBPRQuarters,
  fetchBanks,
  fetchUBPRRatios,
  fetchUBPRPeerComparison,
  fetchUBPRTrend,
} from "../services/api";

import BankSearch        from "../components/ubpr/BankSearch";
import DrillDownModal    from "../components/ubpr/DrillDownModal";
import ExecutiveSummary  from "../components/ubpr/ExecutiveSummary";
import PerformanceTrends from "../components/ubpr/PerformanceTrends";
import PeerBenchmarking  from "../components/ubpr/PeerBenchmarking";
import MultiCompare      from "../components/ubpr/MultiCompare";
import BuildRatio        from "../components/ubpr/BuildRatio";

import { formatQ, buildTrendByKey } from "../utils/ubprFormatters";
import { WM } from "../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";

const TABS = [
  { id: "summary",  label: "Executive Summary"  },
  { id: "trends",   label: "Performance Trends" },
  { id: "peers",    label: "Peer Benchmarking"  },
  { id: "compare",  label: "Multi-Bank Compare" },
  { id: "builder",  label: "Build Ratio"        },
];

const TABS_WITH_SELECTOR = new Set(["summary", "peers"]);

function Spinner({ size = 36 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `3px solid ${BORDER}`, borderTopColor: G,
      borderRadius: "50%", animation: "spin 0.7s linear infinite",
    }} />
  );
}

export default function UBPRDashboard() {
  const [tab, setTab]           = useState("summary");
  const [quarters, setQuarters] = useState([]);
  const [banks, setBanks]       = useState([]);
  const [bank, setBank]         = useState(null);
  const [quarter, setQuarter]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [ratios, setRatios]     = useState(null);
  const [peer, setPeer]         = useState(null);
  const [drill, setDrill]       = useState(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    fetchUBPRQuarters()
      .then(d => {
        const qs = (d.quarters || []).slice().reverse();
        setQuarters(qs);
        if (qs.length > 0) setQuarter(qs[0]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!quarter) return;
    const period = `${quarter.slice(4, 6)}/${quarter.slice(6, 8)}/${quarter.slice(0, 4)}`;
    fetchBanks(period)
      .then(d => setBanks(Array.isArray(d) ? d : []))
      .catch(() => setBanks([]));
  }, [quarter]);

  const handleLoad = useCallback(async () => {
    if (!bank || !quarter) return;
    setLoading(true);
    setError(null);
    setRatios(null);
    setPeer(null);

    try {
      const rssd = String(bank.ID_RSSD);
      const [r, p] = await Promise.all([
        fetchUBPRRatios(rssd, quarter),
        fetchUBPRPeerComparison(rssd, quarter),
      ]);
      setRatios(r);
      setPeer(p);
    } catch (e) {
      setError(e.message || "Failed to load data. Check the backend connection.");
    } finally {
      setLoading(false);
    }
  }, [bank, quarter]);

  /**
   * When user clicks a ratio card on Executive Summary:
   * Fetch the 8-quarter trend for just that one code, then open the drill-down modal.
   */
  const handleRatioClick = useCallback(async ({ ratio }) => {
    if (!bank || !quarter) return;
    setDrillLoading(true);
    setDrill({ ratio, trendData: [] }); // open modal immediately with spinner

    try {
      const rssd = String(bank.ID_RSSD);
      // Default to 8 quarters back from selected quarter
      const qIdx   = quarters.indexOf(quarter);
      const fromQ  = quarters[Math.min(qIdx + 7, quarters.length - 1)] || quarters[quarters.length - 1];
      const toQ    = quarter;
      const data   = await fetchUBPRTrend(rssd, fromQ, toQ, [ratio.key]);
      const byKey  = buildTrendByKey(data);
      const points = byKey[ratio.key] || [];
      setDrill({ ratio, trendData: points });
    } catch (e) {
      console.error("Drill-down trend fetch failed:", e);
      setDrill(prev => prev ? { ...prev, trendData: [] } : null);
    } finally {
      setDrillLoading(false);
    }
  }, [bank, quarter, quarters]);

  const showSelector = TABS_WITH_SELECTOR.has(tab);
  const bankName     = String(bank?.Name || "").trim();

  return (
    <div style={{ padding: "24px 28px", background: BG, minHeight: "100%", fontFamily: "system-ui, sans-serif" }}>

      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
          <div style={{
            width: 4, height: 36, background: G, borderRadius: 2, flexShrink: 0,
          }} />
          <div>
            <div style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: 26, fontWeight: 700, color: TEXT, letterSpacing: "-0.3px", lineHeight: 1.1,
            }}>
              Financial Analysis
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 3, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 500 }}>
              Uniform Bank Performance Report
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: `2px solid ${BORDER}`, marginBottom: 24, gap: 2 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 22px", fontSize: 13,
            fontFamily: tab === t.id ? "Georgia, 'Times New Roman', serif" : "system-ui, sans-serif",
            fontWeight: tab === t.id ? 700 : 400,
            fontStyle: tab === t.id ? "italic" : "normal",
            color: tab === t.id ? G : MUTED,
            background: tab === t.id ? "rgba(17,87,64,0.04)" : "transparent",
            border: "none",
            borderBottom: tab === t.id ? `2px solid ${G}` : "2px solid transparent",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer", marginBottom: -2, transition: "all 0.15s",
            letterSpacing: tab === t.id ? "0.01em" : 0,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Institution selector */}
      {showSelector && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 140px", gap: 14, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: MUTED, marginBottom: 6 }}>Institution</div>
              <BankSearch banks={banks} value={bank} onSelect={setBank} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: MUTED, marginBottom: 6 }}>Quarter</div>
              <select value={quarter} onChange={e => setQuarter(e.target.value)}
                style={{ width: "100%", padding: "10px 10px", fontSize: 13, border: `1.5px solid ${BORDER}`, borderRadius: 8, outline: "none", background: "#fff" }}>
                {quarters.map(q => <option key={q} value={q}>{formatQ(q)}</option>)}
              </select>
            </div>
            <button onClick={handleLoad} disabled={!bank || !quarter || loading} style={{
              padding: "10px 20px", fontSize: 13, fontWeight: 700,
              background: bank && !loading ? G : "#d4ddd8",
              color: bank && !loading ? "#fff" : "#8fa89a",
              border: "none", borderRadius: 8,
              cursor: bank && !loading ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              {loading && <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
              {loading ? "Loading…" : "Load"}
            </button>
          </div>
          {bank && (
            <div style={{ marginTop: 12, padding: "8px 14px", background: BG, borderRadius: 8, fontSize: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: ratios ? GREEN : BORDER, flexShrink: 0 }} />
              <strong style={{ color: TEXT }}>{bankName}</strong>
              <span style={{ color: MUTED }}>RSSD {bank.ID_RSSD}{bank.City ? ` · ${bank.City}` : ""}</span>
              <span style={{ color: G, fontWeight: 700, marginLeft: "auto" }}>{formatQ(quarter)}</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, fontSize: 13, color: "#dc2626", marginBottom: 20 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
          <Spinner />
        </div>
      )}

      {!loading && (
        <>
          {tab === "summary" && (
            ratios
              ? <ExecutiveSummary bank={bank} quarter={quarter} ratioData={ratios} peerData={peer} onRatioClick={handleRatioClick} />
              : !error && <EmptyState />
          )}

          <div style={{ display: tab === "trends" ? "block" : "none" }}>
            {bank
              ? <PerformanceTrends bank={bank} quarters={quarters} banks={banks} />
              : <EmptyState />
            }
          </div>

          {tab === "peers" && (
            <PeerBenchmarking bank={bank} quarter={quarter} peerData={peer} ratioData={ratios} />
          )}

          {tab === "compare" && <MultiCompare quarters={quarters} banks={banks} />}
          {tab === "builder" && <BuildRatio quarters={quarters} banks={banks} />}
        </>
      )}

      {drill && (
        <DrillDownModal
          ratio={drill.ratio}
          trendData={drill.trendData}
          bankName={bankName}
          loading={drillLoading}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "80px 0", color: MUTED }}>
      <div style={{ fontSize: 36, marginBottom: 14 }}>◎</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 6 }}>Select an institution and quarter to begin</div>
      <div style={{ fontSize: 12 }}>Data sourced from FFIEC UBPR · Stored in Cloudflare R2 · Queried via DuckDB</div>
    </div>
  );
}