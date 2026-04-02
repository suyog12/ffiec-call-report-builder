import { useState } from "react";
import { CATEGORY_COLORS, getRatioMeta } from "../../constants/ubprRatios";
import { fmtVal, formatQ, getRegulatoryStatus, exportCSV } from "../../utils/ubprFormatters";
import { fetchUBPRPeerComparison } from "../../services/api";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";
const RED    = "#dc2626";

const PEER_GROUPS = [
  { value: "all",            label: "All Commercial Banks",        desc: "~6,000 FDIC-insured institutions" },
  { value: "size:large",     label: "Large Banks (>$100B assets)", desc: "JPMorgan, BofA, Wells Fargo tier" },
  { value: "size:mid",       label: "Mid-Size ($10B–$100B)",       desc: "Regional banks" },
  { value: "size:community", label: "Community Banks (<$10B)",     desc: "Local & community institutions" },
  { value: "size:small",     label: "Small Community (<$1B)",      desc: "Small community banks" },
];

function Spinner({ size = 14 }) {
  return <div style={{ width: size, height: size, border: `2px solid ${BORDER}`, borderTopColor: G, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

export default function PeerBenchmarking({ bank, quarter, peerData: initialPeerData, ratioData }) {
  const [peerGroup, setPeerGroup] = useState("all");
  const [peerData, setPeerData]   = useState(initialPeerData);
  const [loading, setLoading]     = useState(false);

  const bankRatios = ratioData?.ratios || {};
  const peerAvgs   = peerData?.peer_averages || {};
  const bankName   = String(bank?.Name || "").trim().replace(/\s+/g, " ");
  const shortName  = bankName.split(" ").slice(0, 3).join(" "); // e.g. "BANK OF AMERICA"
  const peerCodes  = Object.keys(peerAvgs);

  const loadPeerGroup = async (group) => {
    if (!bank || !quarter) return;
    setPeerGroup(group);
    setLoading(true);
    try {
      const d = await fetchUBPRPeerComparison(String(bank.ID_RSSD), quarter, group);
      setPeerData(d);
    } catch (e) {
      console.error("Peer fetch failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => exportCSV(
    ["UBPR Code", "Label", "Category", bankName, "Peer Average (excl. this bank)", "Difference (pp)", "Position"],
    peerCodes.map(code => {
      const meta = getRatioMeta(code);
      const bv   = bankRatios[code];
      const pv   = peerAvgs[code];
      const bn   = parseFloat(bv);
      const pn   = parseFloat(pv);
      const diff = !isNaN(bn) && !isNaN(pn) ? (bn - pn).toFixed(2) : "—";
      const pos  = !isNaN(bn) && !isNaN(pn) ? ((meta.higherBetter ? bn >= pn : bn <= pn) ? "Above" : "Below") : "—";
      return [code, meta.label, meta.category, fmtVal(bv, false), fmtVal(pv, false), diff, pos];
    }),
    `${bankName.slice(0, 20)}_${formatQ(quarter)}_peers.csv`
  );

  if (!ratioData) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: MUTED, fontSize: 13 }}>
        Load an institution on the Executive Summary tab first.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Peer group selector */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 14 }}>Select Peer Group</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {PEER_GROUPS.map(pg => (
            <button
              key={pg.value}
              onClick={() => loadPeerGroup(pg.value)}
              disabled={loading}
              style={{
                padding: "10px 16px", borderRadius: 8, cursor: "pointer",
                background: peerGroup === pg.value ? G : "#fff",
                color: peerGroup === pg.value ? "#fff" : TEXT,
                border: `1.5px solid ${peerGroup === pg.value ? G : BORDER}`,
                fontSize: 12, fontWeight: peerGroup === pg.value ? 700 : 500,
                transition: "all 0.15s", textAlign: "left",
              }}
            >
              <div>{pg.label}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{pg.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Results table */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Peer Group Comparison</div>
            <div style={{ fontSize: 12, color: MUTED }}>
              {bankName} vs. {PEER_GROUPS.find(p => p.value === peerGroup)?.label} · {formatQ(quarter)}
            </div>
            <div style={{ fontSize: 10, color: MUTED, marginTop: 3, fontStyle: "italic" }}>
              Peer average excludes {shortName}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {loading && <Spinner />}
            <button onClick={handleExport} disabled={loading || peerCodes.length === 0}
              style={{ fontSize: 11, fontWeight: 600, color: G, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 16px", cursor: "pointer" }}>
              Export CSV
            </button>
          </div>
        </div>

        {peerCodes.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: MUTED, fontSize: 13 }}>
            {loading ? "Loading peer data…" : "No peer comparison data available."}
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 110px",
              padding: "9px 16px",
              fontSize: 11, fontWeight: 700, textTransform: "uppercase",
              letterSpacing: 0.8, color: MUTED,
              borderBottom: `2px solid ${BORDER}`,
            }}>
              <div>Ratio</div>
              {/* Bank name instead of "This Bank" */}
              <div style={{ textAlign: "right", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {shortName}
              </div>
              <div style={{ textAlign: "right" }}>Peer Avg</div>
              <div style={{ textAlign: "right" }}>Difference</div>
              <div style={{ textAlign: "center" }}>Position</div>
            </div>

            {peerCodes.map((code, i) => {
              const meta = getRatioMeta(code);
              const bv   = bankRatios[code];
              const pv   = peerAvgs[code];
              const bn   = parseFloat(bv);
              const pn   = parseFloat(pv);
              const diff = !isNaN(bn) && !isNaN(pn) ? bn - pn : null;
              const good = diff === null ? null : (meta.higherBetter ? diff >= 0 : diff <= 0);
              const reg  = getRegulatoryStatus(code, bv);

              return (
                <div key={code} style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 110px",
                  padding: "12px 16px",
                  borderBottom: `1px solid ${BORDER}`,
                  background: i % 2 === 0 ? "#fff" : BG,
                  alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>{meta.label}</div>
                    <div style={{ fontSize: 10, color: CATEGORY_COLORS[meta.category] || MUTED }}>{meta.category}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{fmtVal(bv, false)}</div>
                    {reg && reg.status !== "healthy" && (
                      <div style={{ fontSize: 10, color: reg.color, fontWeight: 600 }}>⚠ {reg.label}</div>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: MUTED, textAlign: "right" }}>{fmtVal(pv, false)}</div>
                  <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: diff === null ? MUTED : good ? GREEN : RED }}>
                    {diff === null ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}pp`}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    {good !== null && (
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: good ? GREEN : RED,
                        background: good ? "#f0fdf4" : "#fef2f2",
                        padding: "3px 10px", borderRadius: 99,
                      }}>
                        {good ? "▲ Above" : "▼ Below"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}