import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
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

import { formatQ } from "../utils/ubprFormatters";
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

const UBPRDashboard = forwardRef(function UBPRDashboard(
  { onBankLoaded, onQuartersLoaded },
  ref
) {
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
  const [trendOverride, setTrendOverride] = useState(null);

  useEffect(() => {
    fetchUBPRQuarters()
      .then(d => {
        const qs = (d.quarters || []).slice().reverse();
        setQuarters(qs);
        if (qs.length > 0) setQuarter(qs[0]);
        onQuartersLoaded?.(qs);
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

  const handleLoad = useCallback(async (overrideBank, overrideQuarter) => {
    const targetBank    = overrideBank    || bank;
    const targetQuarter = overrideQuarter || quarter;
    if (!targetBank || !targetQuarter) return;
    if (overrideBank)    setBank(overrideBank);
    if (overrideQuarter) setQuarter(overrideQuarter);
    setLoading(true);
    setError(null);
    setRatios(null);
    setPeer(null);
    try {
      const rssd = String(targetBank.ID_RSSD);
      const [r, p] = await Promise.all([
        fetchUBPRRatios(rssd, targetQuarter),
        fetchUBPRPeerComparison(rssd, targetQuarter),
      ]);
      setRatios(r);
      setPeer(p);
      onBankLoaded?.(targetBank, targetQuarter);
    } catch (e) {
      setError(e.message || "Failed to load data. Check the backend connection.");
    } finally {
      setLoading(false);
    }
  }, [bank, quarter]);

  useImperativeHandle(ref, () => ({
    loadTrend({ rssdId, bankObj, quarterStr, metricCode, fromQuarter, toQuarter }) {
      setTab("trends");
      if (bankObj) {
        setBank(bankObj);
        if (quarterStr) setQuarter(quarterStr);
      } else if (rssdId && banks.length > 0) {
        const found = banks.find(b => String(b.ID_RSSD) === String(rssdId));
        if (found) {
          setBank(found);
          if (quarterStr) setQuarter(quarterStr);
        }
      }
      setTrendOverride({
        metricCode:  metricCode  || null,
        fromQuarter: fromQuarter || null,
        toQuarter:   toQuarter   || null,
      });
    },
    loadSummary({ bankObj, quarterStr }) {
      if (bankObj) setBank(bankObj);
      if (quarterStr) setQuarter(quarterStr);
      setTab("summary");
      handleLoad(bankObj, quarterStr);
    },
    loadPeers({ bankObj, quarterStr }) {
      if (bankObj) setBank(bankObj);
      if (quarterStr) setQuarter(quarterStr);
      setTab("peers");
    },
  }), [banks, handleLoad]);

  const handleRatioClick = useCallback(async ({ ratio }) => {
    if (!bank || !quarter) return;
    setDrillLoading(true);
    setDrill({ ratio, trendData: [] });
    try {
      const rssd  = String(bank.ID_RSSD);
      const qIdx  = quarters.indexOf(quarter);
      const fromQ = quarters[Math.min(qIdx + 7, quarters.length - 1)] || quarters[quarters.length - 1];
      const data  = await fetchUBPRTrend(rssd, fromQ, quarter, [ratio.key]);
      const byKey = {};
      (data.trend || []).forEach(row => {
        const q = row.quarter_date;
        Object.entries(row).forEach(([k, v]) => {
          if (k === "quarter_date") return;
          if (!byKey[k]) byKey[k] = [];
          byKey[k].push({ quarter: q, value: v });
        });
      });
      setDrill({ ratio, trendData: byKey[ratio.key] || [] });
    } catch (e) {
      setDrill(prev => prev ? { ...prev, trendData: [] } : null);
    } finally {
      setDrillLoading(false);
    }
  }, [bank, quarter, quarters]);

  const showSelector = TABS_WITH_SELECTOR.has(tab);
  const bankName     = String(bank?.Name || "").trim();

  return (
    // Outer wrapper — full height flex column, no scroll
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100%", background: BG,
      fontFamily: "system-ui, sans-serif",
      overflow: "hidden",
    }}>

      {/* ── Sticky header + tab bar ─────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: "24px 28px 0",
        background: BG,
        borderBottom: `2px solid ${BORDER}`,
      }}>
        {/* Title */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, letterSpacing: "-0.3px" }}>
            Financial Analysis
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            Uniform Bank Performance Report · Cloudflare R2 + DuckDB
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "10px 20px", fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? G : MUTED,
              background: "transparent", border: "none",
              borderBottom: tab === t.id ? `2px solid ${G}` : "2px solid transparent",
              cursor: "pointer", marginBottom: -2, transition: "color 0.15s",
            }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Scrollable content area ─────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

        {/* Institution selector — only on summary + peers */}
        {showSelector && (
          <div style={{
            background: "#fff", borderRadius: 12, padding: 20,
            marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}>
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
              <button onClick={() => handleLoad()} disabled={!bank || !quarter || loading} style={{
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
                ? <PerformanceTrends
                    bank={bank}
                    quarters={quarters}
                    banks={banks}
                    trendOverride={trendOverride}
                    onTrendOverrideConsumed={() => setTrendOverride(null)}
                  />
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

      </div>{/* end scrollable content */}

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
});

export default UBPRDashboard;

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "80px 0", color: MUTED }}>
      <div style={{ fontSize: 36, marginBottom: 14 }}>◎</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
        Select an institution and quarter to begin
      </div>
      <div style={{ fontSize: 12 }}>
        Data sourced from FFIEC UBPR · Stored in Cloudflare R2 · Queried via DuckDB
      </div>
    </div>
  );
}