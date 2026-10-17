#!/usr/bin/env bash
# Exercise a single, disposable object in a private DineFlow CI bucket.
set -euo pipefail

: "${S3_TEST_BUCKET:?Set S3_TEST_BUCKET to a dedicated dineflow-ci-* bucket.}"
: "${S3_TEST_REGION:?Set S3_TEST_REGION to the test bucket region.}"
: "${S3_TEST_ACCOUNT_ID:?Set S3_TEST_ACCOUNT_ID to the owning AWS account ID.}"

if [[ ! "$S3_TEST_BUCKET" =~ ^dineflow-ci-[a-z0-9.-]+$ ]]; then
  echo "Refusing to use a bucket that is not named dineflow-ci-*." >&2
  exit 1
fi
if [[ ! "$S3_TEST_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo "S3_TEST_ACCOUNT_ID must be a 12-digit AWS account ID." >&2
  exit 1
fi
if [[ "$S3_TEST_BUCKET" == "${AVATAR_STORAGE_BUCKET:-}" ]]; then
  echo "Refusing to use the configured application avatar bucket." >&2
  exit 1
fi

command -v aws >/dev/null || { echo "AWS CLI is required." >&2; exit 1; }
command -v openssl >/dev/null || { echo "OpenSSL is required." >&2; exit 1; }

actual_account_id="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$actual_account_id" != "$S3_TEST_ACCOUNT_ID" ]]; then
  echo "AWS identity does not match S3_TEST_ACCOUNT_ID; refusing to write." >&2
  exit 1
fi

work_dir="$(mktemp -d)"
run_id="${GITHUB_RUN_ID:-local}"
object_key="ci/dineflow-storage/${run_id}-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8).txt"
object_created=false

cleanup() {
  if [[ "$object_created" == true ]]; then
    aws s3api delete-object --bucket "$S3_TEST_BUCKET" --key "$object_key" \
      --expected-bucket-owner "$S3_TEST_ACCOUNT_ID" --region "$S3_TEST_REGION" >/dev/null \
      || echo "WARNING: cleanup failed for test object $object_key" >&2
  fi
  rm -f "$work_dir/payload" "$work_dir/downloaded" "$work_dir/anonymous" "$work_dir/error"
  rmdir "$work_dir"
}
trap cleanup EXIT

printf 'DineFlow S3 integration test: %s\n' "$object_key" > "$work_dir/payload"

echo "Checking signed upload..."
object_created=true
aws s3api put-object --bucket "$S3_TEST_BUCKET" --key "$object_key" \
  --body "$work_dir/payload" --content-type text/plain \
  --expected-bucket-owner "$S3_TEST_ACCOUNT_ID" --region "$S3_TEST_REGION" >/dev/null

echo "Checking signed read and exact bytes..."
aws s3api get-object --bucket "$S3_TEST_BUCKET" --key "$object_key" \
  --expected-bucket-owner "$S3_TEST_ACCOUNT_ID" --region "$S3_TEST_REGION" \
  "$work_dir/downloaded" >/dev/null
cmp "$work_dir/payload" "$work_dir/downloaded"

echo "Checking that anonymous read is denied..."
if aws s3api get-object --no-sign-request --bucket "$S3_TEST_BUCKET" --key "$object_key" \
  --region "$S3_TEST_REGION" "$work_dir/anonymous" > /dev/null 2> "$work_dir/error"; then
  echo "FAIL: anonymous read succeeded; the test bucket is not private." >&2
  exit 1
fi
if ! grep -Eq 'AccessDenied|Forbidden|\(403\)' "$work_dir/error"; then
  echo "FAIL: anonymous read failed for a reason other than access denial." >&2
  sed -n '1,4p' "$work_dir/error" >&2
  exit 1
fi

echo "Checking delete and absence..."
aws s3api delete-object --bucket "$S3_TEST_BUCKET" --key "$object_key" \
  --expected-bucket-owner "$S3_TEST_ACCOUNT_ID" --region "$S3_TEST_REGION" >/dev/null
if aws s3api head-object --bucket "$S3_TEST_BUCKET" --key "$object_key" \
  --expected-bucket-owner "$S3_TEST_ACCOUNT_ID" --region "$S3_TEST_REGION" \
  > /dev/null 2> "$work_dir/error"; then
  echo "FAIL: deleted object is still readable." >&2
  exit 1
fi
if ! grep -Eq 'Not Found|\(404\)|NoSuchKey' "$work_dir/error"; then
  echo "FAIL: could not verify deletion (expected 404)." >&2
  sed -n '1,4p' "$work_dir/error" >&2
  exit 1
fi
object_created=false

echo "PASS: upload, byte-for-byte read, private access, and delete in $S3_TEST_BUCKET."
