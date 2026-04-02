import { useState, useRef } from "react";
import { CARD_ACCENTS } from "../theme/colors.js";

function BankLogo({ bankName, size = 22 }) {
  const clean = (bankName || "")
    .toLowerCase()
    .replace(/[',\.&]/g, " ")
    .replace(/\b(national|association|inc|corp|corporation|trust|financial|savings|community|federal|na|fsb|ssb|bancorp|bancshares|holding|holdings|group|co|company|ltd|llc|of|the|and|dba)\b/g, "")
    .replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const slug  = words.slice(0, 2).join("").replace(/[^a-z0-9]/g, "");
  const initials = words.slice(0, 2).map(w => w[0].toUpperCase()).join("") || "??";
  const svgBadge = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="4" fill="rgba(255,255,255,0.3)"/><text x="50%" y="54%" font-family="system-ui,sans-serif" font-size="${Math.round(size*0.42)}" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`
  );
  return (
    <img src={`https://logo.clearbit.com/${slug}.com`} alt={initials}
      width={size} height={size}
      style={{ borderRadius: 4, objectFit: "contain", background: "rgba(255,255,255,0.2)", flexShrink: 0 }}
      onError={e => { e.target.onerror = null; e.target.src = svgBadge; }}
    />
  );
}

// ── PDF viewer for a single period ───────────────────────────
function PDFViewer({ pdfUrl, bankName, period, accent }) {
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);
  const [error,   setError]   = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(null);

  // Auto-load when mounted (since user already clicked the tab)
  const startLoad = () => {
    if (loaded || loading) return;
    setLoading(true);
    setProgress(0);
    let p = 0;
    progressRef.current = setInterval(() => {
      p += Math.random() * 8;
      if (p >= 85) { p = 85; clearInterval(progressRef.current); }
      setProgress(Math.round(p));
    }, 250);
  };

  // Trigger load on first render of this viewer
  useState(() => { startLoad(); });

  const handleLoad = () => {
    clearInterval(progressRef.current);
    setProgress(100);
    setTimeout(() => { setLoading(false); setLoaded(true); }, 400);
  };

  const handleError = () => {
    clearInterval(progressRef.current);
    setLoading(false);
    setError(true);
  };

  return (
    <div style={{ position: "relative" }}>
      {loading && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 2,
          background: "#f8fafc",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
          minHeight: 300,
        }}>
          <div style={{
            width: 36, height: 36,
            border: "3px solid #e2e8f0",
            borderTopColor: accent,
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
              Loading PDF…
            </div>
            <div style={{ width: 240, height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: progress + "%",
                background: `linear-gradient(90deg, ${accent}, ${accent}99)`,
                borderRadius: 99, transition: "width 0.3s ease",
              }} />
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>
              {progress}% · Pages rendering in browser
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div style={{
          padding: "48px 20px", textAlign: "center",
          color: "#94a3b8", fontSize: 13,
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚠</div>
          Could not load the PDF. The document may not be available for this period.
        </div>
      ) : (
        <iframe
          src={pdfUrl}
          title={`Call Report PDF – ${bankName} ${period}`}
          style={{
            width: "100%",
            height: "78vh",
            minHeight: 520,
            border: "none",
            display: "block",
            opacity: loading ? 0 : 1,
            transition: "opacity 0.3s ease",
          }}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  );
}

// ── Bank card: header + period tabs + viewer ──────────────────
function BankPDFCard({ bankName, periods, accent }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [expanded, setExpanded]   = useState(false);

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 20,
      boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
    }}>
      {/* Card header — clickable to expand/collapse */}
      <div
        onClick={() => setExpanded(o => !o)}
        style={{ background: accent, padding: "16px 20px", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BankLogo bankName={bankName} size={24} />
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 12, fontWeight: 800, color: "#fff",
              textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              {bankName}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 }}>
              FFIEC Call Report · {periods.length} period{periods.length > 1 ? "s" : ""}
            </div>
          </div>
          {/* Chevron */}
          <div style={{
            width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, color: "#fff",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}>▼</div>
        </div>
      </div>

      {/* Tabs + viewer — only shown when expanded */}
      {expanded && periods.length > 1 && (
        <div style={{
          display: "flex",
          borderBottom: "1px solid #e2e8f0",
          background: "#f8fafc",
          overflowX: "auto",
        }}>
          {periods.map((p, i) => (
            <button
              key={p.period}
              onClick={() => setActiveIdx(i)}
              style={{
                padding: "10px 20px",
                fontSize: 12,
                fontWeight: activeIdx === i ? 700 : 500,
                color: activeIdx === i ? accent : "#64748b",
                background: "transparent",
                border: "none",
                borderBottom: activeIdx === i ? `2px solid ${accent}` : "2px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
                marginBottom: -1,
              }}
            >
              {p.period}
            </button>
          ))}
        </div>
      )}

      {/* PDF viewer — display:none preserves loaded state across tab switches */}
      {expanded && periods.map((p, i) => (
        <div key={p.period} style={{ display: activeIdx === i ? "block" : "none" }}>
          <PDFViewer
            pdfUrl={p.pdfUrl}
            bankName={bankName}
            period={p.period}
            accent={accent}
          />
        </div>
      ))}
    </div>
  );
}

// ── Main PDFPage ──────────────────────────────────────────────
export default function PDFPage({ reports }) {
  const list = reports || [];

  if (list.length === 0) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 32, marginBottom: 12, fontWeight: 300 }}>⎙</div>
        <p style={{ fontSize: 14 }}>No reports loaded yet.</p>
      </div>
    );
  }

  // Group by bank name, preserve insertion order
  const bankMap = new Map();
  list.forEach(r => {
    if (!bankMap.has(r.bankName)) bankMap.set(r.bankName, []);
    bankMap.get(r.bankName).push({ period: r.period, pdfUrl: r.pdfUrl });
  });
  const banks = Array.from(bankMap.entries()); // [[bankName, periods[]], ...]

  const uniqueBanks   = banks.length;
  const uniquePeriods = [...new Set(list.map(r => r.period))].length;

  return (
    // ⚠ No overflow:hidden, no fixed height — let content grow naturally
    <div style={{ minHeight: 0 }}>
      {/* Summary row */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>
          {uniqueBanks === 1 ? banks[0][0] : `${list.length} PDF Reports`}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {uniqueBanks === 1
            ? `${uniquePeriods} period${uniquePeriods > 1 ? "s" : ""}`
            : `${uniqueBanks} bank${uniqueBanks > 1 ? "s" : ""} · ${uniquePeriods} period${uniquePeriods > 1 ? "s" : ""}`}
        </div>
        {uniqueBanks > 1 && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "3px 10px", borderRadius: 99 }}>
            Click period tabs to switch PDF
          </div>
        )}
      </div>

      {/* One card per bank */}
      {banks.map(([bankName, periods], i) => (
        <BankPDFCard
          key={bankName}
          bankName={bankName}
          periods={periods}
          accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
        />
      ))}
    </div>
  );
}