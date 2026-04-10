from __future__ import annotations

import argparse
import logging
import os
from datetime import date, datetime

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from ffiec_data_collector import FFIECDownloader

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cleanup")

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

R2_ENDPOINT = os.getenv("R2_ENDPOINT", "").rstrip("/")
ACCESS_KEY  = os.getenv("R2_ACCESS_KEY_ID", "")
SECRET_KEY  = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET      = os.getenv("R2_BUCKET", "ffiec-data")


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )


def list_r2_quarters(s3) -> dict:
    """Return all quarters stored in R2 with their object keys."""
    stored = {}
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix="ubpr/year="):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith("/data.parquet"):
                continue
            parts = key.split("/")
            if len(parts) != 4:
                continue
            quarter = parts[2].replace("quarter=", "")
            if len(quarter) == 8 and quarter.isdigit():
                stored[quarter] = key
    return stored


def list_ffiec_published_quarters(start_year: int = 2001) -> set[str]:
    """
    Generate the set of quarters FFIEC has confirmed published.
    Steps back 2 quarters from today to stay within the publication window.
    """
    quarter_ends = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
    today        = date.today()
    current_q    = (today.month - 1) // 3 + 1
    current_year = today.year

    # Step back 2 quarters — same logic as ubpr_ingest.py
    current_q -= 2
    if current_q <= 0:
        current_q    += 4
        current_year -= 1

    quarters = set()
    year, q  = current_year, current_q
    while year > start_year or (year == start_year and q >= 1):
        quarters.add(f"{year}{quarter_ends[q]}")
        q -= 1
        if q == 0:
            q    = 4
            year -= 1

    return quarters


def run(dry_run: bool = False) -> None:
    s3 = get_s3_client()

    logger.info("=" * 60)
    logger.info("R2 Unpublished Quarter Cleanup")
    logger.info("Dry run : %s", dry_run)
    logger.info("Bucket  : %s", BUCKET)
    logger.info("=" * 60)

    # What is in R2
    r2_quarters = list_r2_quarters(s3)
    logger.info("R2 quarters found : %d", len(r2_quarters))

    # What FFIEC has published
    published = list_ffiec_published_quarters()
    logger.info("FFIEC published   : %d quarters (latest: %s)",
                len(published), max(published))

    # Find quarters in R2 that are NOT in the published set
    to_delete = {q: key for q, key in r2_quarters.items() if q not in published}

    if not to_delete:
        logger.info("No unpublished quarters found in R2. Nothing to clean up.")
        return

    logger.info("Quarters to delete: %d", len(to_delete))
    for quarter, key in sorted(to_delete.items(), reverse=True):
        logger.info("  %s  →  %s", quarter, key)

    if dry_run:
        logger.info("[DRY RUN] No objects deleted.")
        return

    # Delete each unpublished quarter
    deleted = []
    failed  = []

    for quarter, key in sorted(to_delete.items(), reverse=True):
        try:
            # Delete the Parquet file
            s3.delete_object(Bucket=BUCKET, Key=key)
            logger.info("Deleted : %s", key)

            # Also delete the partition prefix folder marker if it exists
            prefix = key.replace("data.parquet", "")
            s3.delete_object(Bucket=BUCKET, Key=prefix)

            deleted.append(quarter)
        except ClientError as exc:
            logger.error("Failed to delete %s: %s", key, exc)
            failed.append(quarter)

    logger.info("=" * 60)
    logger.info("SUMMARY")
    logger.info("  Deleted : %d  %s", len(deleted), deleted)
    logger.info("  Failed  : %d  %s", len(failed), failed or "")
    logger.info("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Remove unpublished quarters from R2 that FFIEC has not yet released."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without actually deleting anything.",
    )
    args = parser.parse_args()
    run(dry_run=args.dry_run)