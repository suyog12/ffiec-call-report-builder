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
df = con.execute(f"SELECT * FROM read_parquet('{url}') WHERE rssd_id = '852218'").df()
row = df.iloc[0]
cols = df.columns.tolist()

# JPMorgan Q4 2025 known approximate values:
# NPL ratio ~0.5-0.7% (noncurrent loans / total loans)
# Net charge-off rate ~0.5-0.8% annualized

# Print ALL ratio-like columns (0.001 to 0.02) — NPL and NCO should be here
print("=== All ratio columns between 0.001 and 0.02 (likely NPL/NCO range) ===")
for c in sorted(cols):
    if not c.startswith("UBPR"):
        continue
    val = row.get(c)
    try:
        fval = float(val)
        if 0.001 <= fval <= 0.02:
            print(f"  {c}: {fval:.4f} ({fval*100:.2f}%)")
    except:
        pass

# Also check the confirmed working ratios for comparison
print("\n=== Confirmed working ratios for JPMorgan ===")
working = {
    "UBPR7400": "Tier 1 Capital Ratio",
    "UBPR7402": "Total Capital Ratio (alt)",
    "UBPR7408": "Leverage Ratio (alt)",
    "UBPR7204": "ROA",
    "UBPR7205": "ROE",
    "UBPR7206": "NIM",
    "UBPR7308": "Equity/Assets",
    "UBPR7316": "Loan/Deposit",
}
for code, label in working.items():
    if code in cols:
        print(f"  {code} ({label}): {row.get(code)}")

con.close()