export const CARD_ACCENTS = [
  "#115740",  // William & Mary green      -primary / most prominent
  "#1a4731",  // deep forest green         -strong supporting green
  "#1e3a5f",  // academic navy             -trusted contrast
  "#173a2f",  // dark muted green          -subtle depth
  "#162b5c",  // dark royal blue           -clean analytical contrast
  "#2d3748",  // charcoal slate            -neutral anchor
  "#103d4f",  // deep slate teal           -cool supporting tone
  "#0e3d38",  // dark spruce green         -earthy institutional tone
  "#5c2d0a",  // dark burnt sienna         -warm heritage accent
  "#3d1a04",  // very dark amber           -classic academic warmth
  "#5e1535",  // deep burgundy             -formal accent
  "#26215c",  // dark indigo               -reserved chart contrast
  "#b5a16a",  // William & Mary gold       -highlight / premium accent
];

// ── Schedule-specific colors (FFIEC schedule families) ────────
// Each schedule gets a fixed color aligned more closely to a William & Mary theme.
export const SCHEDULE_COLORS = {
  "RC":    "#115740",  // W&M green        -Balance Sheet flagship
  "RI":    "#1a4731",  // deep forest      -Income Statement
  "RC-C":  "#1e3a5f",  // academic navy    -Loans & Leases
  "RIA":   "#5c2d0a",  // burnt sienna     -Income (addendum)
  "RIE":   "#103d4f",  // slate teal       -Income (equity)
  "RIBII": "#5e1535",  // deep burgundy    -Interest (detail)
  "RIC":   "#2d3748",  // charcoal         -Income (detail)
  "ENT":   "#0e3d38",  // dark spruce      -Entity
  "SU":    "#162b5c",  // royal blue       -Summary
  "NARR":  "#173a2f",  // dark muted green -Narrative
  "CI":    "#b5a16a",  // W&M gold         -Changes in Equity
  "RID":   "#26215c",  // dark indigo      -Income (detail)
  "RIBI":  "#3d1a04",  // dark amber       -Interest (detail)
  "RIB":   "#1a4731",  // deep forest      -Interest (income)
};

// ── W&M brand colors (sidebar/buttons only) ───────────────────
export const WM = {
  green:      "#115740",
  greenDark:  "#0d4232",
  greenMid:   "#1a6b4f",
  gold:       "#b5a16a",
  goldLight:  "#cbb98a",
  navy:       "#1e3a5f",
  text:       "#d1e8df",
  muted:      "#7aaa95",
  border:     "#0f4a35",
  panel:      "#0f2f25",
  bg:         "#081c17",
};