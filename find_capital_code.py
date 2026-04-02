import duckdb, os, pandas as pd
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

# Find columns with values in capital ratio range (10-20) for JPMorgan
# JPMorgan Tier 1 = 14.5%, Total Capital ~17%, Leverage ~6%
print("=== Columns with values 10-20 (capital ratio range for JPMorgan) ===")
for c in sorted(df.columns):
    if not c.startswith("UBPR"):
        continue
    try:
        v = float(row[c])
        if 10 <= v <= 20:
            print(f"  {c}: {v}")
    except:
        pass

print("\n=== Columns with values 5-9 (leverage ratio range ~5.8%) ===")
for c in sorted(df.columns):
    if not c.startswith("UBPR"):
        continue
    try:
        v = float(row[c])
        if 5 <= v <= 9:
            print(f"  {c}: {v}")
    except:
        pass

print("\n=== Columns with values 0.05-0.20 (ROA/ROE/NIM range) ===")
for c in sorted(df.columns):
    if not c.startswith("UBPR"):
        continue
    try:
        v = float(row[c])
        if 0.05 <= v <= 0.20:
            print(f"  {c}: {v}")
    except:
        pass

con.close()