import MetricCard from "../components/MetricCard";

function fmtVal(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && v < 1 && v > -1 && v !== 0) return (v * 100).toFixed(2) + "%";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return String(v);
}

export default function Overview({ metrics, bank, period }) {
  const m = metrics || {};
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{bank}</h2>
        <span style={{ fontSize: 12, color: "#64748b" }}>{period}</span>
      </div>
      <div className="metrics-grid">
        <MetricCard label="Total Assets"    value={fmtVal(m.total_assets)} />
        <MetricCard label="Total Loans"     value={fmtVal(m.total_loans)} />
        <MetricCard label="Total Deposits"  value={fmtVal(m.total_deposits)} />
        <MetricCard label="Total Equity"    value={fmtVal(m.total_equity)} />
        <MetricCard label="Net Income"      value={fmtVal(m.net_income)} />
        <MetricCard label="Equity / Assets" value={fmtVal(m.equity_to_assets)} />
        <MetricCard label="Loans / Deposits" value={fmtVal(m.loans_to_deposits)} />
      </div>
    </div>
  );
}
