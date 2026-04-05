# Example Outputs

Expected outputs for each example input category.

---

## Example 1: Capital Adequacy Query

**Input:** "Is Bank of America well capitalized?"

**Expected output:**
```
Based on UBPR data for Q4 2025 (RSSD: 480228):

Bank of America's capital position:
• CET1 Ratio (UBPRD487): 12.47% — WELL-CAPITALIZED (min: 4.5%, well-cap: 8%)
• Total Capital Ratio (UBPRD488): 13.51% — WELL-CAPITALIZED (min: 8%, well-cap: 10%)
• Leverage Ratio (UBPRD486): 7.36% — WELL-CAPITALIZED (min: 4%, well-cap: 5%)

Bank of America is well-capitalized across all three regulatory measures. 
Their CET1 ratio of 12.47% exceeds the well-capitalized threshold by 4.47 
percentage points, providing a significant buffer above regulatory minimums.

Note: These ratios are compared against Basel III standards effective since 2015.
```

**Dashboard action triggered:**
```json
{
  "type": "load_ubpr",
  "tab": "summary",
  "rssd_id": "480228",
  "quarter": "20251231"
}
```

---

## Example 2: Call Report Period Query

**Input:** "Show me the Q3 2025 Call Report for JPMorgan"

**Expected output:**
```
Loading JPMorgan Chase Bank (RSSD: 852218) Call Report for Q3 2025 (9/30/2025):

Key metrics from the filing:
• Total Assets:   $4.02T
• Total Loans:    $1.33T  
• Total Deposits: $2.89T
• Total Equity:   $343B
• Net Income:     $13.1B

Ratios:
• Equity-to-Assets:    8.53%
• Loans-to-Deposits:   46.02%

I've loaded the Q3 2025 report in the dashboard. You can navigate to:
• PDF tab — view the original filing facsimile
• Sections tab — explore Schedule RC (Balance Sheet) and RI (Income)
• Metrics tab — see all computed financial metrics
```

**Dashboard action triggered:**
```json
{
  "type": "load_report",
  "tab": "pdf",
  "rssd_id": "852218",
  "period": "9/30/2025"
}
```

---

## Example 3: Period Not Available

**Input:** "Show me the Q1 2026 Call Report"

**Expected output:**
```
Q1 2026 (3/31/2026) has not yet been filed with the FFIEC — 
quarterly filings are typically submitted 30-60 days after quarter-end.

The nearest available period is Q4 2025 (12/31/2025). 
Loading that report instead.

[Q4 2025 data displayed...]
```

---

## Example 4: Out of Scope

**Input:** "What is the weather in New York?"

**Expected output:**
```
I'm specialized in FFIEC bank financial analysis and cannot help with that.
I can answer questions about:
• Call Report filings (balance sheets, income statements, loan data)
• UBPR financial ratios (capital, profitability, liquidity, asset quality)
• Peer group benchmarking
• Regulatory capital adequacy

What would you like to know about a bank's financial performance?
```

**Dashboard action triggered:** `null` (no navigation)

---

## Example 5: Multi-turn Memory

**Turn 1 input:** "Tell me about Bank of America's capital position"
**Turn 1 output:** [Capital ratio analysis for BofA]

**Turn 2 input:** "How does that compare to JPMorgan?"
**Turn 2 output:**
```
Comparing Bank of America and JPMorgan Chase capital ratios (Q4 2025):

                    BofA        JPMorgan    Difference
CET1 Ratio:        12.47%      15.29%      -2.82pp
Total Capital:     13.51%      16.18%      -2.67pp
Leverage Ratio:     7.36%       8.94%      -1.58pp

Both banks are well-capitalized, but JPMorgan maintains significantly 
higher capital ratios across all three measures. JPMorgan's CET1 ratio 
of 15.29% provides a larger buffer above the 8% well-capitalized threshold.
```
