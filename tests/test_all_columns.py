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

# Print ALL UBPR codes so we can find NPL and charge-off manually
ubpr_cols = sorted([c for c in cols if c.startswith("UBPR")])
print(f"Total UBPR columns: {len(ubpr_cols)}")
print("\nAll UBPR codes:")
for c in ubpr_cols:
    print(c)