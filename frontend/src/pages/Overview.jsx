import { CARD_ACCENTS } from "../theme/colors.js";

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

// Single period row inside a bank card
function PeriodRow({ report, accent, isLast }) {
  const m = report.metrics || {};
  const metrics = [
    { label: "Total Assets",   value: fmtNum(m.total_assets) },
    { label: "Total Loans",    value: fmtNum(m.total_loans) },
    { label: "Total Deposits", value: fmtNum(m.total_deposits) },
    { label: "Total Equity",   value: fmtNum(m.total_equity) },
    { label: "Net Income",     value: fmtNum(m.net_income) },
    { label: "Equity/Assets",  value: fmtPct(m.equity_to_assets) },
    { label: "Loans/Deposits", value: fmtPct(m.loans_to_deposits) },
    { label: "Res. Ratio",     value: fmtPct(m.residential_ratio) },
  ];

  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid #f0f4ee" }}>
      {/* Period label row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 16px",
        background: "#f8fafc",
        borderBottom: "1px solid #f0f4ee",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, flexShrink: 0, opacity: 0.7 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: 0.2 }}>
          {report.period}
        </span>
      </div>
      {/* Metrics grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", borderBottom: "1px solid #f0f4ee" }}>
        {metrics.slice(0, 4).map(({ label, value }, i) => (
          <div key={label} style={{
            padding: "11px 14px",
            borderRight: i < 3 ? "1px solid #f0f4ee" : "none",
          }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: value === "—" ? "#cbd5e1" : "#0f172a", letterSpacing: "-0.5px" }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        {metrics.slice(4).map(({ label, value }, i) => (
          <div key={label} style={{
            padding: "11px 14px",
            borderRight: i < 3 ? "1px solid #f0f4ee" : "none",
          }}>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: value === "—" ? "#cbd5e1" : accent, letterSpacing: "-0.5px" }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// One card per bank, containing all periods
function BankCard({ bankName, reports, accent }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    }}>
      {/* Bank header */}
      <div style={{ background: accent, padding: "16px 18px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <BankLogo bankName={bankName} accent={accent} size={22} />
          <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bankName}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {reports.map(r => (
            <span key={r.period} style={{
              fontSize: 10, color: "rgba(255,255,255,0.8)",
              background: "rgba(255,255,255,0.15)",
              padding: "2px 8px", borderRadius: 99,
              border: "1px solid rgba(255,255,255,0.2)",
            }}>
              {r.period}
            </span>
          ))}
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
        padding: "6px 14px",
        background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0",
      }}>
        {["Total Assets", "Total Loans", "Total Deposits", "Total Equity"].map((h, i) => (
          <div key={h} style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, color: "#64748b", paddingRight: i < 3 ? 14 : 0 }}>
            {h}
          </div>
        ))}
      </div>

      {/* Period rows */}
      {reports.map((report, i) => (
        <PeriodRow
          key={report.period}
          report={report}
          accent={accent}
          isLast={i === reports.length - 1}
        />
      ))}

      <div style={{ padding: "6px 14px", background: "#f8fafc", borderTop: "1px solid #f1f5f9", fontSize: 9, color: "#cbd5e1", textAlign: "right" }}>
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

  // Group reports by bank name, assign one consistent color per bank
  const bankMap = {};
  const bankOrder = [];
  list.forEach(r => {
    if (!bankMap[r.bankName]) {
      bankMap[r.bankName] = [];
      bankOrder.push(r.bankName);
    }
    bankMap[r.bankName].push(r);
  });

  const uniqueBanks   = bankOrder.length;
  const uniquePeriods = [...new Set(list.map(r => r.period))].length;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>
          {list.length === 1 ? list[0].bankName : `${list.length} Reports`}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {list.length === 1
            ? list[0].period
            : `${uniqueBanks} bank${uniqueBanks > 1 ? "s" : ""} · ${uniquePeriods} period${uniquePeriods > 1 ? "s" : ""}`}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {bankOrder.map((bankName, i) => (
          <BankCard
            key={bankName}
            bankName={bankName}
            reports={bankMap[bankName]}
            accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
          />
        ))}
      </div>
    </div>
  );
}