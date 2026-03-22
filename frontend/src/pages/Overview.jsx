const CARD_ACCENTS = [
  // Colorblind-safe, professional financial palette
  // Distinguishable under deuteranopia, protanopia, and tritanopia
  "#2563eb",  // blue
  "#059669",  // forest green
  "#7c3aed",  // muted purple
  "#b45309",  // warm amber
  "#0891b2",  // teal
  "#be185d",  // deep rose
  "#374151",  // slate
  "#0d9488",  // dark teal
  "#6d28d9",  // indigo
  "#047857",  // emerald
  "#9f1239",  // dark rose
  "#1d4ed8",  // royal blue
  "#92400e",  // dark amber
];

function fmtNum(v) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtPct(v) {
  if (v === null || v === undefined) return "—";
  return (v * 100).toFixed(2) + "%";
}

function BankLogo({ bankName, accent, size = 22 }) {
  const clean = bankName
    .toLowerCase()
    .replace(/[',\.&]/g, " ")
    .replace(/\b(national|association|inc|corp|corporation|trust|financial|savings|community|federal|na|fsb|ssb|bancorp|bancshares|holding|holdings|group|co|company|ltd|llc|of|the|and|dba)\b/g, "")
    .replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const slug  = words.slice(0, 2).join("").replace(/[^a-z0-9]/g, "");
  const domain = slug + ".com";
  const initials = words.slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const svgBadge = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="4" fill="rgba(255,255,255,0.3)"/><text x="50%" y="54%" font-family="system-ui,sans-serif" font-size="${Math.round(size * 0.42)}" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`
  );
  return (
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={initials} width={size} height={size}
      style={{ borderRadius: 4, objectFit: "contain", background: "rgba(255,255,255,0.2)", flexShrink: 0 }}
      onError={e => { e.target.onerror = null; e.target.src = svgBadge; }}
    />
  );
}

function SnapshotCard({ report, accent }) {
  const m = report.metrics || {};
  const highlights = [
    { label: "Total Assets",   value: fmtNum(m.total_assets),   sub: "RCFD2170 · $K" },
    { label: "Total Loans",    value: fmtNum(m.total_loans),    sub: "RCFD2122 · $K" },
    { label: "Total Deposits", value: fmtNum(m.total_deposits), sub: "RCFD2200 · $K" },
    { label: "Total Equity",   value: fmtNum(m.total_equity),   sub: "RCFD3210 · $K" },
  ];
  const ratios = [
    { label: "Net Income",        value: fmtNum(m.net_income),        sub: "RIAD4340 · $K" },
    { label: "Equity / Assets",   value: fmtPct(m.equity_to_assets),  sub: "Capital adequacy" },
    { label: "Loans / Deposits",  value: fmtPct(m.loans_to_deposits), sub: "Loan-to-deposit" },
    { label: "Residential Ratio", value: fmtPct(m.residential_ratio), sub: "% of total loans" },
  ];

  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0",
      borderRadius: 14, overflow: "hidden",
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ background: accent, padding: "16px 18px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          <BankLogo bankName={report.bankName} accent={accent} size={22} />
          <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {report.bankName}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.5)", flexShrink: 0 }} />
          {report.period}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid #f1f5f9" }}>
        {highlights.map(({ label, value, sub }, i) => (
          <div key={label} style={{ padding: "13px 14px", borderRight: i % 2 === 0 ? "1px solid #f1f5f9" : "none", borderBottom: i < 2 ? "1px solid #f1f5f9" : "none" }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: value === "—" ? "#cbd5e1" : "#0f172a", letterSpacing: "-0.5px" }}>{value}</div>
            <div style={{ fontSize: 9, color: "#cbd5e1", marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }}>
        {ratios.map(({ label, value, sub }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderBottom: "1px solid #f8fafc" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#374151" }}>{label}</div>
              <div style={{ fontSize: 9, color: "#cbd5e1" }}>{sub}</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: value === "—" ? "#cbd5e1" : accent, letterSpacing: "-0.3px" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "7px 14px", background: "#f8fafc", borderTop: "1px solid #f1f5f9", fontSize: 9, color: "#cbd5e1", textAlign: "right" }}>
        Values in thousands (USD)
      </div>
    </div>
  );
}

export default function Overview({ reports }) {
  const list = reports || [];

  if (list.length === 0) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 32, marginBottom: 12, fontWeight: 300 }}>◈</div>
        <p style={{ fontSize: 14 }}>Select a bank and period, then click <strong style={{ color: "#0f172a" }}>Load Report</strong>.</p>
      </div>
    );
  }

  const uniqueBanks   = [...new Set(list.map(r => r.bankName))].length;
  const uniquePeriods = [...new Set(list.map(r => r.period))].length;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>
          {list.length === 1 ? list[0].bankName : `${list.length} Reports`}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {list.length === 1 ? list[0].period : `${uniqueBanks} bank${uniqueBanks > 1 ? "s" : ""} · ${uniquePeriods} period${uniquePeriods > 1 ? "s" : ""}`}
        </div>
        {list.length > 1 && (
          <div style={{ marginLeft: "auto", fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "3px 10px", borderRadius: 99 }}>
            Switch to Metrics for full comparison table
          </div>
        )}
      </div>

      {/* Responsive grid — fills screen width, wraps to next row automatically */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14,
        alignItems: "start",
      }}>
        {list.map((report, i) => (
          <SnapshotCard key={report.bankName + "::" + report.period} report={report} accent={CARD_ACCENTS[i % CARD_ACCENTS.length]} />
        ))}
      </div>
    </div>
  );
}