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

# Get all column names
cols = con.execute(f"SELECT * FROM read_parquet('{url}') LIMIT 0").df().columns.tolist()
print(f"Total columns: {len(cols)}")
print("\nFirst 20 columns:")
print(cols[:20])

# Check which of our KEY_RATIO_CODES exist
key_codes = ["UBPR7400", "UBPR7401", "UBPR7404", "UBPR7204", "UBPR7205",
             "UBPR7206", "UBPR7308", "UBPR7316", "UBPR1975", "UBPRJJ33"]

print("\nKey ratio codes - present in Parquet?")
for code in key_codes:
    found = code in cols
    print(f"  {code}: {'✓' if found else '✗ MISSING'}")

# Search for similar column names if missing
print("\nColumns containing '7400' or 'capital':")
matches = [c for c in cols if "7400" in c or "capital" in c.lower()]
print(matches[:10])

print("\nColumns containing '7204' or 'roa':")
matches = [c for c in cols if "7204" in c or "roa" in c.lower()]
print(matches[:10])

# Get JPMorgan's actual values for first 15 columns
df = con.execute(f"""
    SELECT *
    FROM read_parquet('{url}')
    WHERE rssd_id = '852218'
""").df()
print(f"\nJPMorgan row found: {len(df)} rows")
print("First 15 column values:")
for col in df.columns[:15]:
    print(f"  {col}: {df[col].iloc[0]}")

con.close()