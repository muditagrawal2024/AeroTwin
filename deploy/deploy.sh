#!/usr/bin/env bash
# Upload AeroTwin to S3 and refresh CloudFront.
# Usage: ./deploy/deploy.sh <bucket-name> <cloudfront-distribution-id>
set -euo pipefail

BUCKET="${1:?bucket name required}"
DIST="${2:?CloudFront distribution id required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

EXCLUDES=(--exclude ".git/*" --exclude ".github/*" --exclude "deploy/*" --exclude "docs/*" --exclude "*.md" --exclude "LICENSE" --exclude ".gitignore")

# 1. Static assets: cache for a week at the edge and in browsers.
aws s3 sync "$ROOT" "s3://$BUCKET" --delete "${EXCLUDES[@]}" --exclude "*.html" \
  --cache-control "public, max-age=604800"

# 2. HTML pages: always revalidate so a new release shows up immediately.
aws s3 sync "$ROOT" "s3://$BUCKET" "${EXCLUDES[@]}" --exclude "*" --include "*.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"

# 3. Tell CloudFront to drop its cached copies.
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query 'Invalidation.Id' --output text

echo "Deployed. Open: https://$(aws cloudfront get-distribution --id "$DIST" --query 'Distribution.DomainName' --output text)"
