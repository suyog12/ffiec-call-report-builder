import duckdb, os
from dotenv import load_dotenv

load_dotenv("bigdata/.env")

endpoint = os.getenv("R2_ENDPOINT", "").replace("https://", "").rstrip("/")
key      = os.getenv("R2_ACCESS_KEY_ID", "")
secret   = os.getenv("R2_SECRET_ACCESS_KEY", "")

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute(f"""
    SET s3_endpoint          = '{endpoint}';
    SET s3_access_key_id     = '{key}';
    SET s3_secret_access_key = '{secret}';
    SET s3_region            = 'auto';
    SET s3_use_ssl           = true;
    SET s3_url_style         = 'path';
""")

url = "s3://ffiec-data/ubpr/year=2025/quarter=20251231/data.parquet"
cols = con.execute(f"SELECT * FROM read_parquet('{url}') LIMIT 0").df().columns.tolist()
df = con.execute(f"SELECT * FROM read_parquet('{url}') WHERE rssd_id = '852218'").df()
row = df.iloc[0]

# Confirmed correct codes from FFIEC documentation
candidates = {
    # Capital
    "UBPR7400": "Tier 1 Capital Ratio",
    "UBPR7402": "Total Capital Ratio (checking alt)",
    "UBPR7408": "Leverage Ratio (checking alt)",
    # Profitability  
    "UBPR7204": "ROA",
    "UBPR7205": "ROE",
    "UBPR7206": "NIM",
    # Capital
    "UBPR7308": "Equity to Assets",
    # Liquidity
    "UBPR7316": "Loan to Deposit Ratio",
    # Asset Quality — confirmed from FFIEC docs
    "UBPR7414": "Noncurrent Loans to Gross Loans (NPL) — CONFIRMED CODE",
    # Net charge-off candidates
    "UBPRC193": "Net Charge-Off Rate candidate",
    "UBPRC194": "Net Charge-Off Rate candidate",
    "UBPRC195": "Net Charge-Off Rate candidate",
    "UBPRD199": "Net Charge-Offs to Avg Loans candidate",
    "UBPRD198": "Net Charge-Offs candidate",
    "UBPR5440": "Net Charge-Off candidate",
    "UBPR5441": "Net Charge-Off candidate",
    "UBPRB618": "Net Charge-Off candidate",
    "UBPRB619": "Net Charge-Off candidate",
}

print("=== Code verification ===")
for code, label in candidates.items():
    exists = code in cols
    val = row.get(code) if exists else "MISSING"
    print(f"  {code} ({label}): {val}")

# Search for any column with value between 0.001 and 0.015 that starts with C or D
print("\n=== UBPRC and UBPRD ratio columns (0.001-0.015 range) ===")
for c in sorted(cols):
    if not c.startswith(("UBPRC", "UBPRD")):
        continue
    val = row.get(c)
    try:
        fval = float(val)
        if 0.001 <= fval <= 0.015:
            print(f"  {c}: {fval:.4f} ({fval*100:.2f}%)")
    except:
        pass

con.close()