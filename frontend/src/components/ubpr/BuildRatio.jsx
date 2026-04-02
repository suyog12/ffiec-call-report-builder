import { useState } from "react";
import BankSearch from "./BankSearch";
import { fmtMoney, formatQ, exportCSV, loadWatchlist, saveWatchlist } from "../../utils/ubprFormatters";
import { WM } from "../../theme/colors";

const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";
const GREEN  = "#16a34a";
const RED    = "#dc2626";
const GOLD   = WM.gold;

function Spinner({ size = 14 }) {
  return <div style={{ width: size, height: size, border: `2px solid rgba(255,255,255,0.3)`, borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;
}

export default function BuildRatio({ quarters, banks }) {
  const [bank, setBank]       = useState(null);
  const [quarter, setQuarter] = useState(quarters[0] || "");
  const [numCode, setNumCode] = useState("");
  const [denCode, setDenCode] = useState("");
  const [label, setLabel]     = useState("");
  const [scale, setScale]     = useState("percent");
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [watchlist, setWatchlist] = useState(loadWatchlist);

  const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

  const compute = async () => {
    if (!bank || !numCode.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${BASE_URL}/ubpr/all-fields?rssd_id=${bank.ID_RSSD}&quarter_date=${quarter}`);
      if (!resp.ok) throw new Error(`Backend returned ${resp.status} — check that the server is running`);
      const data   = await resp.json();
      const fields = data.fields || {};
      const num    = parseFloat(fields[numCode.trim()]);
      const den    = denCode.trim() ? parseFloat(fields[denCode.trim()]) : null;

      if (isNaN(num)) throw new Error(`Code "${numCode.trim()}" was not found in the data for this quarter. Check the UBPR code.`);
      if (denCode.trim() && (isNaN(den) || den === 0)) throw new Error(`Denominator "${denCode.trim()}" is zero or not found.`);

      const raw = den !== null ? num / den : num;

      // UBPR ratio codes are already stored as percentages (e.g. 1.34 = 1.34%)
      // Only multiply by 100 if the result looks like a fraction (i.e. |raw| < 1 and no denominator)
      // When user provides a denominator, they're doing raw division so respect their scale choice
      const isAlreadyPct = den === null && Math.abs(raw) <= 200 && numCode.trim().startsWith("UBPR");
      const display =
        scale === "percent"
          ? (isAlreadyPct ? raw.toFixed(2) : (raw * 100).toFixed(2)) + "%"
          : scale === "dollar"
          ? fmtMoney(raw)
          : raw.toFixed(4);

      setResult({ raw, display, numVal: num, denVal: den });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const addToWatchlist = () => {
    if (!result || !label.trim()) return;
    const entry = {
      id:      Date.now(),
      label:   label.trim(),
      numCode: numCode.trim(),
      denCode: denCode.trim(),
      scale,
      value:   result.display,
      bank:    String(bank?.Name || "").trim().slice(0, 40),
      rssd:    bank?.ID_RSSD,
      quarter: formatQ(quarter),
      savedAt: new Date().toISOString(),
    };
    const updated = [entry, ...watchlist];
    setWatchlist(updated);
    saveWatchlist(updated);
    setLabel("");
  };

  const removeFromWatchlist = (id) => {
    const updated = watchlist.filter(w => w.id !== id);
    setWatchlist(updated);
    saveWatchlist(updated);
  };

  const handleExportWatchlist = () => exportCSV(
    ["Label", "Formula", "Value", "Bank", "Quarter", "Saved Date"],
    watchlist.map(w => [
      w.label,
      `${w.numCode}${w.denCode ? " / " + w.denCode : ""}`,
      w.value,
      w.bank,
      w.quarter,
      w.savedAt.slice(0, 10),
    ]),
    "ubpr_watchlist.csv"
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Builder card */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, marginBottom: 4 }}>Custom Ratio Builder</div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 20, lineHeight: 1.6 }}>
          Enter any UBPR field codes to construct a custom ratio.
          Codes starting with "UBPR" are pre-calculated composites.
          Other codes (e.g. RIAD4340) map directly to Call Report schedule line items.
        </div>

        {/* Bank + quarter selectors */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12, marginBottom: 16 }}>
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
        </div>

        {/* Formula builder */}
        <div style={{ background: BG, borderRadius: 10, padding: "16px 18px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, marginBottom: 12 }}>Formula: Numerator ÷ Denominator</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 20px 1fr 150px", gap: 12, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>Numerator code *</div>
              <input
                value={numCode}
                onChange={e => setNumCode(e.target.value.toUpperCase())}
                placeholder="e.g. UBPR7204"
                style={{ width: "100%", padding: "9px 12px", fontSize: 13, border: `1.5px solid ${BORDER}`, borderRadius: 8, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }}
              />
            </div>
            <div style={{ textAlign: "center", fontSize: 20, color: "#94a3b8", paddingBottom: 8 }}>÷</div>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>Denominator code (optional)</div>
              <input
                value={denCode}
                onChange={e => setDenCode(e.target.value.toUpperCase())}
                placeholder="blank = raw value"
                style={{ width: "100%", padding: "9px 12px", fontSize: 13, border: `1.5px solid ${BORDER}`, borderRadius: 8, outline: "none", boxSizing: "border-box", fontFamily: "monospace" }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>Display as</div>
              <select value={scale} onChange={e => setScale(e.target.value)}
                style={{ width: "100%", padding: "9px 10px", fontSize: 13, border: `1.5px solid ${BORDER}`, borderRadius: 8, outline: "none", background: "#fff" }}>
                <option value="percent">Percent (%)</option>
                <option value="dollar">Dollar ($)</option>
                <option value="raw">Raw number</option>
              </select>
            </div>
          </div>
        </div>

        <button
          onClick={compute}
          disabled={!bank || !numCode.trim() || loading}
          style={{
            padding: "10px 24px", fontSize: 13, fontWeight: 700,
            background: bank && numCode.trim() ? G : "#d4ddd8",
            color: bank && numCode.trim() ? "#fff" : "#8fa89a",
            border: "none", borderRadius: 8,
            cursor: bank && numCode.trim() ? "pointer" : "not-allowed",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          {loading && <Spinner />}
          {loading ? "Computing…" : "Compute"}
        </button>

        {error && (
          <div style={{ marginTop: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 13, color: RED }}>
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ marginTop: 16, borderRadius: 10, padding: "20px 22px", border: `1.5px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 8 }}>
              {numCode}{denCode ? ` ÷ ${denCode}` : ""} · {formatQ(quarter)} · {String(bank?.Name || "").trim().slice(0, 40)}
            </div>
            <div style={{ fontSize: 40, fontWeight: 800, color: TEXT, letterSpacing: "-1.5px", marginBottom: 8 }}>
              {result.display}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 16 }}>
              Numerator: {fmtMoney(result.numVal)}
              {result.denVal !== null ? ` · Denominator: ${fmtMoney(result.denVal)}` : ""}
            </div>

            <div style={{ padding: "10px 14px", background: "#fffbeb", borderRadius: 8, borderLeft: `3px solid ${GOLD}`, fontSize: 11, color: "#78540a", marginBottom: 16 }}>
              Cross-quarter comparisons may be affected by regulatory definition changes (CECL 2020, Basel III 2015).
            </div>

            {/* Save to watchlist */}
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && label.trim() && addToWatchlist()}
                placeholder="Give this ratio a name to save it…"
                style={{ flex: 1, padding: "9px 12px", fontSize: 13, border: `1.5px solid ${BORDER}`, borderRadius: 8, outline: "none" }}
              />
              <button
                onClick={addToWatchlist}
                disabled={!label.trim()}
                style={{
                  padding: "9px 18px", fontSize: 12, fontWeight: 600,
                  background: label.trim() ? G : "#d4ddd8",
                  color: label.trim() ? "#fff" : "#8fa89a",
                  border: "none", borderRadius: 8,
                  cursor: label.trim() ? "pointer" : "not-allowed",
                }}
              >
                Save to Watchlist
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Watchlist */}
      {watchlist.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Watchlist</div>
              <div style={{ fontSize: 12, color: MUTED }}>Saved ratios persist across sessions.</div>
            </div>
            <button onClick={handleExportWatchlist} style={{ fontSize: 11, fontWeight: 600, color: G, background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer" }}>
              Export CSV
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {watchlist.map(w => (
              <div key={w.id} style={{ background: BG, borderRadius: 10, padding: "14px 16px", borderLeft: `4px solid ${GOLD}`, position: "relative" }}>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{w.bank} · {w.quarter}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: TEXT, marginBottom: 4 }}>{w.label}</div>
                <div style={{ fontSize: 10, color: MUTED, fontFamily: "monospace", marginBottom: 10 }}>
                  {w.numCode}{w.denCode ? ` ÷ ${w.denCode}` : ""}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: TEXT }}>{w.value}</div>
                <button
                  onClick={() => removeFromWatchlist(w.id)}
                  aria-label={`Remove ${w.label} from watchlist`}
                  style={{ position: "absolute", top: 10, right: 10, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}