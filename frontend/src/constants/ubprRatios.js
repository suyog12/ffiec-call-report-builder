/**
 * ubprRatios.js
 *
 * Universal UBPR code lookup map.
 * The backend returns ALL non-null fields for each bank.
 * This map labels and categorizes whatever comes back.
 * Banks that don't report a code simply won't have it — no hardcoding needed.
 */

// ── Category colors ───────────────────────────────────────────────────────────
export const CATEGORY_COLORS = {
  "Capital":       "#115740",
  "Profitability": "#1e3a5f",
  "Liquidity":     "#5c2d0a",
  "Asset Quality": "#5e1535",
  "Growth":        "#103d4f",
  "Other":         "#2d3748",
};

// ── Regulatory minimums (for threshold alerts) ────────────────────────────────
// Values in percentage points to match stored Parquet values (e.g. 14.5 not 0.145)
export const REGULATORY_MINIMUMS = {
  UBPRD487: { min: 6,  warn: 8,  label: "Tier 1 Capital Ratio",   note: "Basel III min 6%, well-capitalized 8%"  },
  UBPRR031: { min: 6,  warn: 8,  label: "CET1 Ratio",             note: "Basel III min 6%, well-capitalized 8%"  },
  UBPRR029: { min: 6,  warn: 8,  label: "CET1 Advanced",          note: "Basel III min 6%, well-capitalized 8%"  },
  UBPRD486: { min: 4,  warn: 5,  label: "Leverage Ratio",         note: "Minimum 4%, well-capitalized 5%"        },
  UBPRD488: { min: 8,  warn: 10, label: "Total Capital Ratio",    note: "Minimum 8%, well-capitalized 10%"       },
  UBPR7400: { min: 4,  warn: 5,  label: "Tier 1 (legacy)",        note: "Minimum 4%"                             },
};

// ── Rule changes that affect trend analysis ───────────────────────────────────
export const RULE_CHANGES = [
  { date: "20200101", label: "CECL adopted",        note: "ASC 326 changed allowance methodology — pre/post not directly comparable" },
  { date: "20150101", label: "Basel III effective",  note: "New capital ratio definitions — affects Tier 1 and CET1 comparisons"     },
];

// ── Priority display codes ────────────────────────────────────────────────────
// When displaying a bank's ratios, show these first (if they exist for the bank)
// and in this order. Then show everything else alphabetically.
export const PRIORITY_CODES = [
  // Capital
  "UBPRD487",  // Tier 1 Risk-Based Capital %
  "UBPRR031",  // CET1 Standardized %
  "UBPRR029",  // CET1 Advanced %
  "UBPRD488",  // Total Capital Ratio %
  "UBPRD486",  // Leverage Ratio %
  "UBPR7308",  // Equity to Assets
  // Profitability
  "UBPRE013",  // ROA
  "UBPRE630",  // ROE
  "UBPRE018",  // NIM (TE, Earning Assets)
  "UBPRE003",  // Net Interest Income % Assets
  // Liquidity
  "UBPRE600",  // Loan to Deposit Ratio
  "UBPR7316",  // Loan to Deposit (alt)
  // Asset Quality
  "UBPR7414",  // NPL (Noncurrent Loans %)
  "UBPRE019",  // Net Charge-Off Rate
  "UBPRE022",  // ACL to Loans
];

// ── Universal UBPR code → metadata lookup ────────────────────────────────────
// Covers the most commonly reported codes across all bank types.
// Unknown codes fall back to their raw code name with category "Other".
export const UBPR_LOOKUP = {
  // ── Capital ─────────────────────────────────────────────────────────────────
  "UBPRD486": { label: "Leverage Ratio",               category: "Capital",       higherBetter: true  },
  "UBPRD487": { label: "Tier 1 Capital Ratio",         category: "Capital",       higherBetter: true  },
  "UBPRD488": { label: "Total Capital Ratio",          category: "Capital",       higherBetter: true  },
  "UBPRR029": { label: "CET1 Ratio (Advanced)",        category: "Capital",       higherBetter: true  },
  "UBPRR030": { label: "CET1 Ratio (Adv. Col B)",      category: "Capital",       higherBetter: true  },
  "UBPRR031": { label: "CET1 Ratio (Standardized)",    category: "Capital",       higherBetter: true  },
  "UBPRR032": { label: "Tier 1 Ratio (Adv. Col B)",    category: "Capital",       higherBetter: true  },
  "UBPRR033": { label: "Total Capital (Std. Col A)",   category: "Capital",       higherBetter: true  },
  "UBPRR034": { label: "Total Capital (Adv. Col B)",   category: "Capital",       higherBetter: true  },
  "UBPR7308": { label: "Equity to Assets",             category: "Capital",       higherBetter: true  },
  "UBPR7400": { label: "Tier 1 (legacy)",              category: "Capital",       higherBetter: true  },
  "UBPR7402": { label: "Total Capital (legacy)",       category: "Capital",       higherBetter: true  },
  "UBPR7408": { label: "Leverage Ratio (legacy)",      category: "Capital",       higherBetter: true  },
  "UBPRE625": { label: "Retained Earnings to Equity",  category: "Capital",       higherBetter: true  },
  "UBPRE626": { label: "Net Loans to Equity (x)",      category: "Capital",       higherBetter: false },
  "UBPRE635": { label: "Equity Capital Growth",        category: "Capital",       higherBetter: true  },
  "UBPRE641": { label: "Total Intangibles to Equity",  category: "Capital",       higherBetter: false },
  "UBPRJ245": { label: "Equity + Min Interests / Assets", category: "Capital",   higherBetter: true  },

  // ── Profitability ────────────────────────────────────────────────────────────
  "UBPRE001": { label: "Interest Income (TE) / Assets",      category: "Profitability", higherBetter: true  },
  "UBPRE002": { label: "Interest Expense / Assets",          category: "Profitability", higherBetter: false },
  "UBPRE003": { label: "Net Interest Income (TE) / Assets",  category: "Profitability", higherBetter: true  },
  "UBPRE004": { label: "Noninterest Income / Assets",        category: "Profitability", higherBetter: true  },
  "UBPRE005": { label: "Noninterest Expense / Assets",       category: "Profitability", higherBetter: false },
  "UBPRE006": { label: "Provision for Credit Losses / Assets", category: "Profitability", higherBetter: false },
  "UBPRE007": { label: "Pretax Operating Income / Assets",   category: "Profitability", higherBetter: true  },
  "UBPRE009": { label: "Pretax Net Operating Income / Assets", category: "Profitability", higherBetter: true },
  "UBPRE010": { label: "Net Operating Income / Assets",      category: "Profitability", higherBetter: true  },
  "UBPRE012": { label: "ROA (Sub S Adjusted)",               category: "Profitability", higherBetter: true  },
  "UBPRE013": { label: "Return on Assets (ROA)",             category: "Profitability", higherBetter: true  },
  "UBPRE014": { label: "Avg Earning Assets / Avg Assets",    category: "Profitability", higherBetter: true  },
  "UBPRE016": { label: "Interest Income (TE) / Earning Assets", category: "Profitability", higherBetter: true },
  "UBPRE017": { label: "Interest Expense / Earning Assets",  category: "Profitability", higherBetter: false },
  "UBPRE018": { label: "Net Interest Margin (NIM)",          category: "Profitability", higherBetter: true  },
  "UBPRE630": { label: "Return on Equity (ROE)",             category: "Profitability", higherBetter: true  },
  "UBPRPG69": { label: "Pre-Provision Net Revenue / Assets", category: "Profitability", higherBetter: true  },
  "UBPR7204": { label: "ROA (raw input)",                    category: "Profitability", higherBetter: true  },
  "UBPR7205": { label: "Total Capital input",                category: "Profitability", higherBetter: true  },
  "UBPR7206": { label: "Tier 1 input",                       category: "Profitability", higherBetter: true  },

  // ── Liquidity ────────────────────────────────────────────────────────────────
  "UBPRE600": { label: "Loan to Deposit Ratio",              category: "Liquidity",     higherBetter: false },
  "UBPR7316": { label: "Loan to Deposit (alt)",              category: "Liquidity",     higherBetter: false },
  "UBPRE015": { label: "Avg Int-Bearing Funds / Assets",     category: "Liquidity",     higherBetter: null  },

  // ── Asset Quality ────────────────────────────────────────────────────────────
  "UBPR7414": { label: "Non-Performing Loans (NPL %)",       category: "Asset Quality", higherBetter: false },
  "UBPRE019": { label: "Net Charge-Off Rate",                category: "Asset Quality", higherBetter: false },
  "UBPRE020": { label: "Earnings Coverage of Net Losses (x)", category: "Asset Quality", higherBetter: true },
  "UBPRE021": { label: "ACL to Net Losses (x)",              category: "Asset Quality", higherBetter: true  },
  "UBPRE022": { label: "ACL on Loans / Total Loans",         category: "Asset Quality", higherBetter: null  },
  "UBPRE395": { label: "ACL to Nonaccrual Loans (x)",        category: "Asset Quality", higherBetter: true  },
  "UBPRE544": { label: "30-89 Days Past Due %",              category: "Asset Quality", higherBetter: false },
  "UBPRE547": { label: "Total Past Due + Nonaccrual %",      category: "Asset Quality", higherBetter: false },
  "UBPRE549": { label: "Noncurrent + OREO / Loans + OREO",   category: "Asset Quality", higherBetter: false },

  // ── Growth ───────────────────────────────────────────────────────────────────
  "UBPR7316_growth": { label: "Loan Growth",                 category: "Growth",        higherBetter: true  },
};

/**
 * Look up metadata for a UBPR code.
 * Returns a safe default if the code isn't in the map.
 */
export function getRatioMeta(code) {
  return UBPR_LOOKUP[code] || {
    label:        code,
    category:     "Other",
    higherBetter: null,
  };
}

/**
 * Given a flat ratios object { UBPRXXXX: value, ... },
 * return an array of ratio objects sorted by:
 *   1. PRIORITY_CODES order first
 *   2. Then by category
 *   3. Then alphabetically by code
 */
export function sortRatios(ratios) {
  const codes = Object.keys(ratios);
  const prioritySet = new Set(PRIORITY_CODES);

  const priority = codes
    .filter(c => prioritySet.has(c))
    .sort((a, b) => PRIORITY_CODES.indexOf(a) - PRIORITY_CODES.indexOf(b));

  const rest = codes
    .filter(c => !prioritySet.has(c))
    .sort((a, b) => {
      const ma = getRatioMeta(a);
      const mb = getRatioMeta(b);
      if (ma.category !== mb.category) return ma.category.localeCompare(mb.category);
      return a.localeCompare(b);
    });

  return [...priority, ...rest].map(code => ({
    code,
    value: ratios[code],
    ...getRatioMeta(code),
  }));
}

export const ALL_RATIO_CODES = Object.keys(UBPR_LOOKUP);