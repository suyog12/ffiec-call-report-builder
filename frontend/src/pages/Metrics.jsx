import { CARD_ACCENTS } from "../theme/colors.js";

function fmtNum(v) { if (v === null || v === undefined) return "—"; return v.toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function fmtPct(v) { if (v === null || v === undefined) return "—"; return (v * 100).toFixed(2) + "%"; }

function BankLogo({ bankName, size = 22 }) {
  const clean = bankName.toLowerCase().replace(/[',\.&]/g," ").replace(/\b(national|association|inc|corp|corporation|trust|financial|savings|community|federal|na|fsb|ssb|bancorp|bancshares|holding|holdings|group|co|company|ltd|llc|of|the|and|dba)\b/g,"").replace(/\s+/g," ").trim();
  const words = clean.split(" ").filter(Boolean);
  const slug  = words.slice(0,2).join("").replace(/[^a-z0-9]/g,"");
  const domain = slug + ".com";
  const initials = words.slice(0,2).map(w => w[0].toUpperCase()).join("");
  const svgBadge = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="4" fill="rgba(255,255,255,0.3)"/><text x="50%" y="54%" font-family="system-ui,sans-serif" font-size="${Math.round(size*0.42)}" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`
  );
  return (
    <img src={`https://logo.clearbit.com/${domain}`} alt={initials} width={size} height={size}
      style={{ borderRadius:4, objectFit:"contain", background:"rgba(255,255,255,0.2)", flexShrink:0 }}
      onError={e => { e.target.onerror=null; e.target.src=svgBadge; }} />
  );
}

const GROUPS = [
  { title: "Balance Sheet", color: "#0ea5e9", rows: [
    { label: "Total Assets",   key: "total_assets",   fmt: fmtNum, desc: "RCFD2170 · $K" },
    { label: "Total Loans",    key: "total_loans",    fmt: fmtNum, desc: "RCFD2122 · $K" },
    { label: "Total Deposits", key: "total_deposits", fmt: fmtNum, desc: "RCFD2200 · $K" },
    { label: "Total Equity",   key: "total_equity",   fmt: fmtNum, desc: "RCFD3210 · $K" },
  ]},
  { title: "Income", color: "#10b981", rows: [
    { label: "Net Income", key: "net_income", fmt: fmtNum, desc: "RIAD4340 · $K" },
  ]},
  { title: "Residential RE", color: "#6366f1", rows: [
    { label: "Residential Total", key: "residential_total", fmt: fmtNum, desc: "1-4 fam + multifam + construction · $K" },
    { label: "Residential Ratio", key: "residential_ratio", fmt: fmtPct, desc: "% of total loans" },
  ]},
  { title: "Capital Ratios", color: "#f59e0b", rows: [
    { label: "Equity / Assets",  key: "equity_to_assets",  fmt: fmtPct, desc: "Capital adequacy" },
    { label: "Loans / Deposits", key: "loans_to_deposits", fmt: fmtPct, desc: "Loan-to-deposit" },
  ]},
];

function MetricsCard({ report, accent }) {
  const m = report.metrics || {};
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.05)", display:"flex", flexDirection:"column" }}>
      {/* Header -same as Overview */}
      <div style={{ background: accent, padding: "16px 18px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:5 }}>
          <BankLogo bankName={report.bankName} size={22} />
          <div style={{ fontSize:11, fontWeight:800, color:"#fff", textTransform:"uppercase", letterSpacing:0.4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {report.bankName}
          </div>
        </div>
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ width:5, height:5, borderRadius:"50%", background:"rgba(255,255,255,0.5)", flexShrink:0 }} />
          {report.period}
        </div>
      </div>

      {/* Groups */}
      {GROUPS.map((group, gi) => (
        <div key={group.title}>
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", background:"#f8fafc", borderTop: gi > 0 ? "1px solid #e2e8f0" : "1px solid #f1f5f9", borderBottom:"1px solid #e2e8f0" }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:group.color, flexShrink:0 }} />
            <span style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"#374151" }}>{group.title}</span>
          </div>
          {group.rows.map(({ label, key, fmt, desc }, ri) => {
            const val = m[key];
            const formatted = fmt(val);
            const isMissing = formatted === "—";
            const isNeg = typeof val === "number" && val < 0;
            const isPct = typeof formatted === "string" && formatted.endsWith("%");
            return (
              <div key={key} style={{ display:"grid", gridTemplateColumns:"1fr auto", alignItems:"center", gap:10, padding:"10px 14px", background: ri%2===0 ? "#fff" : "#fafbfc", borderBottom:"1px solid #f1f5f9" }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:"#374151", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{label}</div>
                  <div style={{ fontSize:9, color:"#cbd5e1", marginTop:1 }}>{desc}</div>
                </div>
                <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", padding: isMissing ? "0" : "3px 9px", borderRadius:6, minWidth:65, background: isMissing ? "transparent" : isPct ? accent+"14" : "#f8fafc", border: isMissing ? "none" : isPct ? `1px solid ${accent}30` : "1px solid #e2e8f0" }}>
                  <span style={{ fontSize:13, fontWeight: isMissing?400:700, fontFamily: isMissing?"inherit":"monospace", color: isMissing?"#cbd5e1":isNeg?"#ef4444":isPct?accent:"#0f172a", letterSpacing:"-0.3px", whiteSpace:"nowrap" }}>
                    {formatted}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ padding:"7px 14px", background:"#f8fafc", borderTop:"1px solid #f1f5f9", fontSize:9, color:"#cbd5e1", textAlign:"right" }}>
        Values in thousands (USD)
      </div>
    </div>
  );
}

export default function Metrics({ reports }) {
  const list = reports || [];

  if (list.length === 0) {
    return (
      <div style={{ padding:"60px 0", textAlign:"center", color:"#94a3b8" }}>
        <div style={{ fontSize:32, marginBottom:12, fontWeight:300 }}>◈</div>
        <p style={{ fontSize:14 }}>No data loaded yet.</p>
      </div>
    );
  }

  const uniqueBanks   = [...new Set(list.map(r => r.bankName))].length;
  const uniquePeriods = [...new Set(list.map(r => r.period))].length;

  return (
    <div>
      <div style={{ marginBottom:20, display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap" }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#0f172a", letterSpacing:"-0.5px" }}>Key Metrics</div>
        <div style={{ fontSize:12, color:"#94a3b8" }}>
          {list.length === 1
            ? list[0].bankName + " · " + list[0].period
            : `${uniqueBanks} bank${uniqueBanks>1?"s":""} · ${uniquePeriods} period${uniquePeriods>1?"s":""}`}
        </div>
        {list.length > 1 && (
          <div style={{ marginLeft:"auto", fontSize:11, color:"#64748b", background:"#f1f5f9", padding:"3px 10px", borderRadius:99 }}>
            {list.length} reports
          </div>
        )}
      </div>

      {/* Same responsive grid as Overview */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14,
        alignItems: "start",
      }}>
        {list.map((report, i) => (
          <MetricsCard key={report.bankName+"::"+report.period} report={report} accent={CARD_ACCENTS[i % CARD_ACCENTS.length]} />
        ))}
      </div>
    </div>
  );
}