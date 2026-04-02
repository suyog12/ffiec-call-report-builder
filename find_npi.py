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

# Get JPMorgan row
df = con.execute(f"""
    SELECT * FROM read_parquet('{url}') WHERE rssd_id = '852218'
""").df()

row = df.iloc[0]

# Print all columns with non-null, non-zero values for JPMorgan
# Focus on codes in ranges likely to be NPL and charge-off
print("=== Searching for NPL / charge-off related columns ===")
print("Columns with 'F6', 'B5', 'C3', 'A5', 'B52', 'B53' patterns:")
patterns = ["UBPRF6", "UBPRB5", "UBPRC3", "UBPRA5", "UBPR3123",
            "UBPR3545", "UBPR3546", "UBPR3547", "UBPR3548"]
for p in patterns:
    matches = [c for c in cols if c.startswith(p)]
    for m in matches:
        val = row.get(m)
        if val is not None and val != 0 and str(val) != "0":
            print(f"  {m}: {val}")

print("\n=== Checking the exact codes we need ===")
# Based on UBPR docs: net charge-offs = UBPRB522, NPL = UBPRB528 or UBPR3123
check_codes = [
    "UBPRB522", "UBPRB528", "UBPRB529", "UBPRB530",
    "UBPR3123", "UBPR3545", "UBPR3546", "UBPRF662",
    "UBPRA517", "UBPRA518", "UBPR5409", "UBPR5410",
    "UBPRD458", "UBPRD459", "UBPRD460",
]
for code in check_codes:
    if code in cols:
        print(f"  {code}: {row.get(code)} ✓ EXISTS")
    else:
        print(f"  {code}: MISSING")

# Also print codes where value looks like a ratio (between 0 and 1)
print("\n=== UBPR columns with ratio-like values for JPMorgan (0.001 to 0.5) ===")
ratio_cols = []
for c in cols:
    if not c.startswith("UBPR"):
        continue
    val = row.get(c)
    try:
        fval = float(val)
        if 0.001 <= fval <= 0.5:
            ratio_cols.append((c, fval))
    except:
        pass

# Sort by value, show all
ratio_cols.sort(key=lambda x: x[1])
print(f"Found {len(ratio_cols)} ratio-like columns")
for c, v in ratio_cols[:40]:
    print(f"  {c}: {v:.4f}")

con.close()