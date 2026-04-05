import { CARD_ACCENTS } from "../theme/colors.js";

function fmtNum(v) { if (v === null || v === undefined) return "-"; return v.toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function fmtPct(v) { if (v === null || v === undefined) return "-"; return (v * 100).toFixed(2) + "%"; }

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

const METRIC_ROWS = [
  { label: "Total Assets",       key: "total_assets",       fmt: fmtNum, desc: "RCFD2170 · $K",                   isPct: false },
  { label: "Total Loans",        key: "total_loans",        fmt: fmtNum, desc: "RCFD2122 · $K",                   isPct: false },
  { label: "Total Deposits",     key: "total_deposits",     fmt: fmtNum, desc: "RCFD2200 · $K",                   isPct: false },
  { label: "Total Equity",       key: "total_equity",       fmt: fmtNum, desc: "RCFD3210 · $K",                   isPct: false },
  { label: "Net Income",         key: "net_income",         fmt: fmtNum, desc: "RIAD4340 · $K",                   isPct: false },
  { label: "Residential Total",  key: "residential_total",  fmt: fmtNum, desc: "1-4 fam + multifam + const · $K", isPct: false },
  { label: "Equity / Assets",    key: "equity_to_assets",   fmt: fmtPct, desc: "Capital adequacy",                isPct: true  },
  { label: "Loans / Deposits",   key: "loans_to_deposits",  fmt: fmtPct, desc: "Loan-to-deposit",                 isPct: true  },
  { label: "Residential Ratio",  key: "residential_ratio",  fmt: fmtPct, desc: "% of total loans",               isPct: true  },
];

const GROUPS = [
  { title: "Balance Sheet", rows: ["total_assets","total_loans","total_deposits","total_equity"] },
  { title: "Income",        rows: ["net_income"] },
  { title: "Residential",   rows: ["residential_total","residential_ratio"] },
  { title: "Capital",       rows: ["equity_to_assets","loans_to_deposits"] },
];

function BankMetricsCard({ bankName, reports, accent }) {
  const rowMap = Object.fromEntries(METRIC_ROWS.map(r => [r.key, r]));

  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>

      {/* Bank header */}
      <div style={{ background: accent, padding: "16px 18px 14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
          <BankLogo bankName={bankName} size={22} />
          <div style={{ fontSize:12, fontWeight:800, color:"#fff", textTransform:"uppercase", letterSpacing:0.4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {bankName}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {reports.map(r => (
            <span key={r.period} style={{ fontSize:10, color:"rgba(255,255,255,0.8)", background:"rgba(255,255,255,0.15)", padding:"2px 8px", borderRadius:99, border:"1px solid rgba(255,255,255,0.2)" }}>
              {r.period}
            </span>
          ))}
        </div>
      </div>

      {/* Column headers: metric name + one col per period */}
      <div style={{ display:"grid", gridTemplateColumns:`180px ${reports.map(()=>"1fr").join(" ")}`, background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
        <div style={{ padding:"8px 14px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"#64748b" }}>Metric</div>
        {reports.map(r => (
          <div key={r.period} style={{ padding:"8px 14px", fontSize:10, fontWeight:700, color:"#374151", textAlign:"right", borderLeft:"1px solid #e2e8f0" }}>
            {r.period}
          </div>
        ))}
      </div>

      {/* Group sections */}
      {GROUPS.map((group, gi) => (
        <div key={group.title}>
          {/* Group label */}
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 14px", background:"#f8fafc", borderTop: gi>0?"1px solid #e2e8f0":"none", borderBottom:"1px solid #e2e8f0" }}>
            <div style={{ width:6, height:6, borderRadius:"50%", background:accent, flexShrink:0, opacity:0.6 }} />
            <span style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"#374151" }}>{group.title}</span>
          </div>
          {group.rows.map((key, ri) => {
            const meta = rowMap[key];
            if (!meta) return null;
            return (
              <div key={key} style={{ display:"grid", gridTemplateColumns:`180px ${reports.map(()=>"1fr").join(" ")}`, background: ri%2===0?"#fff":"#fafbfc", borderBottom:"1px solid #f1f5f9" }}>
                {/* Metric label */}
                <div style={{ padding:"10px 14px" }}>
                  <div style={{ fontSize:12, fontWeight:600, color:"#374151" }}>{meta.label}</div>
                  <div style={{ fontSize:9, color:"#cbd5e1", marginTop:1 }}>{meta.desc}</div>
                </div>
                {/* Values per period */}
                {reports.map(r => {
                  const val = (r.metrics || {})[key];
                  const formatted = meta.fmt(val);
                  const isMissing = formatted === "-";
                  const isNeg = typeof val === "number" && val < 0;
                  return (
                    <div key={r.period} style={{ padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"flex-end", borderLeft:"1px solid #f1f5f9" }}>
                      <span style={{
                        fontSize:13, fontWeight: isMissing?400:700,
                        fontFamily: isMissing?"inherit":"monospace",
                        color: isMissing?"#cbd5e1":isNeg?"#ef4444":meta.isPct?accent:"#0f172a",
                        letterSpacing:"-0.3px",
                      }}>
                        {formatted}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ padding:"6px 14px", background:"#f8fafc", borderTop:"1px solid #f1f5f9", fontSize:9, color:"#cbd5e1", textAlign:"right" }}>
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

  // Group reports by bank name
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
      <div style={{ marginBottom:20, display:"flex", alignItems:"baseline", gap:12, flexWrap:"wrap" }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#0f172a", letterSpacing:"-0.5px" }}>Key Metrics</div>
        <div style={{ fontSize:12, color:"#94a3b8" }}>
          {list.length === 1
            ? list[0].bankName + " · " + list[0].period
            : `${uniqueBanks} bank${uniqueBanks>1?"s":""} · ${uniquePeriods} period${uniquePeriods>1?"s":""}`}
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        {bankOrder.map((bankName, i) => (
          <BankMetricsCard
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