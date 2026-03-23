export const CARD_ACCENTS = [
  "#1e3a5f",  // deep navy blue       -primary / most prominent
  "#1a4731",  // deep forest green    -strong but natural
  "#3b1f6b",  // deep plum violet     -distinctive, not garish
  "#5c2d0a",  // dark burnt sienna    -warm contrast
  "#103d4f",  // deep slate teal      -cool, calm
  "#5e1535",  // deep burgundy        -serious, financial
  "#2d3748",  // charcoal slate       -neutral anchor
  "#0e3d38",  // dark spruce green    -earthy, distinct from forest
  "#26215c",  // dark indigo          -blue-purple, readable
  "#173a2f",  // dark muted green     -distinct from forest
  "#5c1027",  // dark crimson         -strong, alert-free
  "#162b5c",  // dark royal blue      -classic financial
  "#3d1a04",  // very dark amber      -earthy, warm
];

// ── Schedule-specific colors (FFIEC schedule families) ────────
// Each schedule gets a fixed color so RC is always navy, RI always green, etc.
export const SCHEDULE_COLORS = {
  "RC":    "#1e3a5f",  // deep navy       -Balance Sheet flagship
  "RI":    "#1a4731",  // deep forest     -Income Statement
  "RC-C":  "#3b1f6b",  // deep plum       -Loans & Leases
  "RIA":   "#5c2d0a",  // burnt sienna    -Income (addendum)
  "RIE":   "#103d4f",  // slate teal      -Income (equity)
  "RIBII": "#5e1535",  // dark burgundy   -Interest (detail)
  "RIC":   "#2d3748",  // charcoal        -Income (detail)
  "ENT":   "#0e3d38",  // dark spruce     -Entity
  "SU":    "#26215c",  // dark indigo     -Summary
  "NARR":  "#173a2f",  // dark muted green -Narrative
  "CI":    "#5c1027",  // dark crimson    -Changes in Equity
  "RID":   "#162b5c",  // royal blue      -Income (detail)
  "RIBI":  "#3d1a04",  // dark amber      -Interest (detail)
  "RIB":   "#1a4731",  // deep forest     -Interest (income)
};

// ── W&M brand colors (sidebar/buttons only) ───────────────────
export const WM = {
  green:      "#115740",
  greenDark:  "#0d4232",
  greenMid:   "#1a6b4f",
  gold:       "#b5a16a",
  text:       "#d1e8df",
  muted:      "#7aaa95",
  border:     "#0f4a35",
};