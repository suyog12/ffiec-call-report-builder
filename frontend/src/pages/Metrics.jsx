import MetricCard from "../components/MetricCard";

function fmtVal(v, isRatio) {
  if (v === null || v === undefined) return "—";
  if (isRatio) return (v * 100).toFixed(2) + "%";
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#64748b", marginBottom: 10 }}>{title}</div>
      <div className="metrics-grid">{children}</div>
    </div>
  );
}

export default function Metrics({ metrics }) {
  const m = metrics || {};
  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 20, color: "#0f172a" }}>Key Metrics</h3>
      <Section title="Balance Sheet">
        <MetricCard label="Total Assets"   value={fmtVal(m.total_assets)} />
        <MetricCard label="Total Loans"    value={fmtVal(m.total_loans)} />
        <MetricCard label="Total Deposits" value={fmtVal(m.total_deposits)} />
        <MetricCard label="Total Equity"   value={fmtVal(m.total_equity)} />
      </Section>
      <Section title="Income">
        <MetricCard label="Net Income" value={fmtVal(m.net_income)} />
      </Section>
      <Section title="Residential RE">
        <MetricCard label="Residential Total"   value={fmtVal(m.residential_total)} />
        <MetricCard label="Residential / Loans" value={fmtVal(m.residential_ratio, true)} />
      </Section>
      <Section title="Ratios">
        <MetricCard label="Equity / Assets"  value={fmtVal(m.equity_to_assets, true)} />
        <MetricCard label="Loans / Deposits" value={fmtVal(m.loans_to_deposits, true)} />
      </Section>
    </div>
  );
}
