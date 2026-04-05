# Example Inputs

These are sample queries the FFIEC Bank Analysis Agent handles correctly.

---

## UBPR Financial Analysis Queries

**Capital adequacy:**
- "Is JPMorgan well capitalized?"
- "What is Bank of America's CET1 ratio for Q4 2025?"
- "Show me the capital ratios for RSSD 480228"
- "Flag any regulatory issues for this bank"

**Profitability:**
- "What is JPMorgan's ROA?"
- "How does BofA's net interest margin compare to peers?"
- "Show me profitability trends over the last 8 quarters"

**Peer benchmarking:**
- "Compare this bank's ROE to the industry average"
- "How does JPMorgan rank among large banks for capital?"
- "Show peer group comparison for community banks"

**Asset quality:**
- "What is the NPL ratio for Bank of America?"
- "How has the net charge-off rate trended?"

---

## Call Report Queries

**Period-specific:**
- "Show me the Q3 2025 Call Report for JPMorgan"
- "What are BofA's total deposits for December 2024?"
- "Load the most recent filing for this bank"
- "Show me the report from last quarter"

**Balance sheet:**
- "What are JPMorgan's total assets?"
- "Show me the balance sheet for Q4 2025"
- "What is the equity to assets ratio?"

**Income:**
- "What was net income for BofA in Q3 2025?"
- "Show me the income statement"

**Schedule-specific:**
- "Show me Schedule RC for Bank of America"
- "What does Schedule RI show for Q4 2025?"
- "Load the loans and leases schedule"

---

## Multi-turn Conversation

**Turn 1:** "I want to analyze JPMorgan Chase"
**Turn 2:** "What's their ROA?" ← agent remembers JPMorgan from turn 1
**Turn 3:** "How does that compare to Wells Fargo?" ← agent remembers context

---

## Out of Scope (correctly refused)

- "What is the weather today?"
- "Write me a Python script"
- "Who won the Super Bowl?"
- "What is the capital of France?"
- "Help me with my homework"
