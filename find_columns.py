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

# Search for the missing codes and their likely alternatives
searches = {
    "UBPR7401 (Total Capital Ratio)":  ["7401", "7402", "7403"],
    "UBPR7404 (Leverage Ratio)":       ["7404", "7408", "7409"],
    "UBPR1975 (Non-Performing Loans)": ["1975", "NPL", "npl", "nonperf", "NONPERF"],
    "UBPRJJ33 (Net Charge-Off Rate)":  ["JJ33", "jj33", "chargeoff", "CHARGEOFF", "NCO"],
}

for label, patterns in searches.items():
    matches = [c for c in cols if any(p.upper() in c.upper() for p in patterns)]
    print(f"\n{label}")
    print(f"  Matches: {matches[:15]}")

# Also show JPMorgan values for the codes that DO exist
df = con.execute(f"""
    SELECT rssd_id, UBPR7400, UBPR7204, UBPR7205, UBPR7206, UBPR7308, UBPR7316
    FROM read_parquet('{url}')
    WHERE rssd_id = '852218'
""").df()
print("\nJPMorgan working ratio values:")
for col in df.columns[1:]:
    print(f"  {col}: {df[col].iloc[0]}")

con.close()