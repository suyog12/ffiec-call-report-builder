import { REGULATORY_MINIMUMS, RULE_CHANGES } from "../constants/ubprRatios";
export { REGULATORY_MINIMUMS, RULE_CHANGES };

// ── Number formatting ─────────────────────────────────────────────────────────

export function fmtPct(val, decimals = 2) {
  if (val === null || val === undefined || val === "") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  return n.toFixed(decimals) + "%";
}

export function fmtMoney(val) {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  if (Math.abs(n) >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (Math.abs(n) >= 1e9)  return "$" + (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6)  return "$" + (n / 1e6).toFixed(2) + "M";
  return "$" + n.toFixed(2);
}

// Generic formatter — picks percent or money based on the ratio definition.
// Falls back to 4dp for raw ratios.
export function fmtVal(val, isPercent) {
  if (val === null || val === undefined || val === "") return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  if (isPercent) return (n * 100).toFixed(2) + "%";  // legacy, unused
  if (Math.abs(n) >= 1e6) return fmtMoney(n);
  return n.toFixed(2) + "%";
}

// Convert YYYYMMDD → "Q4 2025"
export function formatQ(q) {
  if (!q || q.length < 6) return q || "";
  const y = q.slice(0, 4);
  const m = parseInt(q.slice(4, 6), 10);
  return `Q${Math.ceil(m / 3)} ${y}`;
}

// ── Regulatory helpers ────────────────────────────────────────────────────────

// Returns null if the ratio has no regulatory threshold, otherwise:
// { status: "danger"|"warning"|"healthy", color, label, note }
export function getRegulatoryStatus(ratioKey, value) {
  const reg = REGULATORY_MINIMUMS[ratioKey];
  if (!reg || value === null || value === undefined) return null;
  const n = parseFloat(value);
  if (isNaN(n)) return null;
  if (n < reg.min)  return { status: "danger",  color: "#dc2626", label: "Below Minimum",          note: reg.note };
  if (n < reg.warn) return { status: "warning", color: "#d97706", label: "Below Well-Capitalized", note: reg.note };
  return                   { status: "healthy", color: "#16a34a", label: "Well-Capitalized",        note: reg.note };
}

// Returns the first rule change that falls between two quarter dates,
// or null if no rule change crosses the window.
// Used to warn users when trend data spans a definition change.
export function getRuleChangeWarning(fromQuarter, toQuarter) {
  if (!fromQuarter || !toQuarter) return null;
  const [a, b] = [fromQuarter, toQuarter].sort();
  return RULE_CHANGES.find(r => r.date > a && r.date <= b) || null;
}

// ── CSV export ────────────────────────────────────────────────────────────────

// Triggers a browser download of a CSV file.
// headers: string[]
// rows: (string | number)[][]
export function exportCSV(headers, rows, filename = "export.csv") {
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    headers.map(escape).join(","),
    ...rows.map(r => r.map(escape).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Watchlist persistence ─────────────────────────────────────────────────────

const WATCHLIST_KEY = "ubpr_watchlist";

export function loadWatchlist() {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable (private browsing, storage full) — fail silently
  }
}

// ── Trend data helpers ────────────────────────────────────────────────────────

// Convert the raw trend API response into a lookup map:
// { "UBPR7204": [{ quarter: "Q4 2025", value: "0.0123" }, ...], ... }
export function buildTrendByKey(trendData) {
  const out = {};
  (trendData?.trend || []).forEach(row => {
    Object.keys(row)
      .filter(k => k !== "rssd_id" && k !== "quarter_date")
      .forEach(k => {
        if (!out[k]) out[k] = [];
        out[k].push({ quarter: formatQ(row.quarter_date), value: row[k], raw_quarter: row.quarter_date });
      });
  });
  // Sort each series oldest→newest so charts render left=past, right=present
  Object.keys(out).forEach(k => {
    out[k].sort((a, b) => a.raw_quarter.localeCompare(b.raw_quarter));
  });
  return out;
}