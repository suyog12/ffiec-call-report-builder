"""
clear_r2.py  —  Delete all UBPR data from Cloudflare R2
=========================================================
WARNING: This is destructive and irreversible.
Run with --confirm to actually delete.

Usage:
    python clear_r2.py --dry-run       # show what would be deleted
    python clear_r2.py --confirm       # actually delete everything
    python clear_r2.py --prefix ubpr/by_bank --confirm  # delete only per-bank files
"""

import argparse
import logging
import os

import boto3
from dotenv import load_dotenv

# Try multiple .env locations
for _env in [
    os.path.join(os.path.dirname(__file__), "..", ".env"),  # bigdata/../.env
    os.path.join(os.path.dirname(__file__), ".env"),         # bigdata/.env
    os.path.join(os.path.dirname(__file__), "..", "backend", ".env"),  # backend/.env
]:
    if os.path.exists(_env):
        load_dotenv(dotenv_path=_env)
        break

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("clear_r2")

S3_ENDPOINT    = os.getenv("R2_ENDPOINT", "").rstrip("/")
AWS_ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID", "")
AWS_SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
BUCKET         = os.getenv("R2_BUCKET", "ffiec-data")


def clear_r2(prefix: str = "ubpr/", dry_run: bool = True) -> None:
    s3 = boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=AWS_ACCESS_KEY,
        aws_secret_access_key=AWS_SECRET_KEY,
        region_name="auto",
    )

    paginator = s3.get_paginator("list_objects_v2")
    keys = []
    total_bytes = 0

    logger.info(f"Scanning s3://{BUCKET}/{prefix} ...")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
            total_bytes += obj["Size"]

    total_mb = total_bytes / 1024 / 1024
    logger.info(f"Found {len(keys):,} objects ({total_mb:.1f} MB)")

    if dry_run:
        logger.info("[DRY RUN] Would delete:")
        for k in keys[:20]:
            logger.info(f"  {k}")
        if len(keys) > 20:
            logger.info(f"  ... and {len(keys) - 20} more")
        return

    # Delete in batches of 1000 (S3 API limit)
    deleted = 0
    for i in range(0, len(keys), 1000):
        batch = keys[i:i + 1000]
        s3.delete_objects(
            Bucket=BUCKET,
            Delete={"Objects": [{"Key": k} for k in batch]},
        )
        deleted += len(batch)
        logger.info(f"Deleted {deleted:,}/{len(keys):,} objects...")

    logger.info(f"Done. Deleted {deleted:,} objects ({total_mb:.1f} MB) from R2.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clear UBPR data from Cloudflare R2")
    parser.add_argument("--confirm", action="store_true", help="Actually delete (required)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without deleting")
    parser.add_argument("--prefix", default="ubpr/", help="R2 prefix to delete (default: ubpr/)")
    args = parser.parse_args()

    if not args.confirm and not args.dry_run:
        print("Must specify --confirm or --dry-run")
        raise SystemExit(1)

    clear_r2(prefix=args.prefix, dry_run=not args.confirm)