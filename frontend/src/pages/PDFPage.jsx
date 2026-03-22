import { useState, useRef } from "react";

const CARD_ACCENTS = [
  // Muted, desaturated professional palette — colorblind-safe
  "#1d4ed8",  // steel blue
  "#065f46",  // deep forest green
  "#4c1d95",  // deep violet
  "#78350f",  // dark amber
  "#164e63",  // deep teal
  "#831843",  // deep rose
  "#374151",  // slate
  "#134e4a",  // dark emerald
  "#312e81",  // indigo
  "#064e3b",  // dark green
  "#881337",  // dark crimson
  "#1e3a8a",  // royal blue
  "#451a03",  // dark brown
];

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

// ── Single PDF card ───────────────────────────────────────────
function PDFCard({ pdfUrl, bankName, period, accent }) {
  const [expanded, setExpanded]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [loaded, setLoaded]         = useState(false);
  const [progress, setProgress]     = useState(0);
  const [error, setError]           = useState(false);
  const progressRef                 = useRef(null);

  const handleExpand = () => {
    if (!expanded && !loaded) {
      setExpanded(true);
      setLoading(true);
      setProgress(0);
      // Fake progress that climbs to 85% while iframe loads
      let p = 0;
      progressRef.current = setInterval(() => {
        p += Math.random() * 8;
        if (p >= 85) { p = 85; clearInterval(progressRef.current); }
        setProgress(Math.round(p));
      }, 250);
    } else {
      setExpanded(o => !o);
    }
  };

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
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 16,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    }}>
      {/* Card header — same style as Overview/Metrics/Sections */}
      <div style={{ background: accent, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BankLogo bankName={bankName} size={22} />
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 12, fontWeight: 800, color: "#fff",
              textTransform: "uppercase", letterSpacing: 0.4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {bankName}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.5)", flexShrink: 0 }} />
              {period}
            </div>
          </div>

          {/* Status badge */}
          {loaded && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "#fff",
              background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)",
              padding: "3px 10px", borderRadius: 99,
            }}>
              PDF Ready
            </span>
          )}
          {error && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "#fff",
              background: "rgba(239,68,68,0.4)", border: "1px solid rgba(239,68,68,0.5)",
              padding: "3px 10px", borderRadius: 99,
            }}>
              Failed to load
            </span>
          )}
        </div>
      </div>

      {/* Expand / collapse row */}
      <div
        onClick={handleExpand}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "11px 20px",
          background: "#f8fafc",
          borderBottom: expanded ? "1px solid #e2e8f0" : "none",
          cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: expanded ? accent : accent + "15",
          color: expanded ? "#fff" : accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, transition: "all 0.15s",
        }}>
          ⎙
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
            FFIEC Call Report · {period}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
            {loaded ? "PDF document ready to view" : expanded ? "Loading PDF…" : "Click to open PDF viewer"}
          </div>
        </div>

        {/* Progress bar while loading */}
        {loading && (
          <div style={{ flex: 1, maxWidth: 140 }}>
            <div style={{ height: 4, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: progress + "%",
                background: `linear-gradient(90deg, ${accent}, ${accent}bb)`,
                borderRadius: 99, transition: "width 0.3s ease",
              }} />
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, textAlign: "right" }}>
              {progress}%
            </div>
          </div>
        )}

        <div style={{
          width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
          background: expanded ? accent : "#e2e8f0",
          color: expanded ? "#fff" : "#64748b",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 8, fontWeight: 700, transition: "all 0.15s",
        }}>
          {expanded ? "▲" : "▼"}
        </div>
      </div>

      {/* PDF iframe — shown when expanded */}
      {expanded && (
        <div style={{ position: "relative" }}>
          {/* Loading overlay */}
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
                {/* Full-width progress bar */}
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
              padding: "32px 20px", textAlign: "center",
              color: "#94a3b8", fontSize: 13,
            }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⚠</div>
              Could not load the PDF. The document may not be available for this period.
            </div>
          ) : (
            <iframe
              src={pdfUrl}
              title={`Call Report PDF — ${bankName} ${period}`}
              style={{
                width: "100%",
                height: "75vh",
                minHeight: 500,
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
      )}
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

  const uniqueBanks   = [...new Set(list.map(r => r.bankName))].length;
  const uniquePeriods = [...new Set(list.map(r => r.period))].length;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>
          {list.length === 1 ? list[0].bankName : `${list.length} PDF Reports`}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {list.length === 1
            ? list[0].period
            : `${uniqueBanks} bank${uniqueBanks > 1 ? "s" : ""} · ${uniquePeriods} period${uniquePeriods > 1 ? "s" : ""}`}
        </div>
        {list.length > 1 && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "3px 10px", borderRadius: 99 }}>
            Click any card to open its PDF
          </div>
        )}
      </div>

      {list.map((report, i) => (
        <PDFCard
          key={report.bankName + "::" + report.period}
          pdfUrl={report.pdfUrl}
          bankName={report.bankName}
          period={report.period}
          accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
        />
      ))}
    </div>
  );
}