import duckdb, os, sys
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

# Check rssd_id type and sample values
df = con.execute(f"""
    SELECT rssd_id, typeof(rssd_id) as id_type
    FROM read_parquet('{url}')
    LIMIT 5
""").df()
print("Sample rssd_id values:")
print(df)

# Try to find JPMorgan specifically
df2 = con.execute(f"""
    SELECT rssd_id, typeof(rssd_id) as id_type
    FROM read_parquet('{url}')
    WHERE rssd_id = 852218 OR rssd_id = '852218'
    LIMIT 3
""").df()
print("\nJPMorgan lookup:")
print(df2)

# Check total row count
count = con.execute(f"SELECT COUNT(*) FROM read_parquet('{url}')").fetchone()[0]
print(f"\nTotal rows in Q4 2025: {count}")

con.close()