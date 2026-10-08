# Upload AeroTwin to S3 and refresh CloudFront (Windows PowerShell).
# Usage: .\deploy\deploy.ps1 -Bucket aerotwin-site-mudit -DistributionId E123ABC456
param(
  [Parameter(Mandatory = $true)][string]$Bucket,
  [Parameter(Mandatory = $true)][string]$DistributionId
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Excludes = @('--exclude', '.git/*', '--exclude', '.github/*', '--exclude', 'deploy/*', '--exclude', 'docs/*', '--exclude', '*.md', '--exclude', 'LICENSE', '--exclude', '.gitignore')

# Static assets: cache for a week
aws s3 sync $Root "s3://$Bucket" --delete @Excludes --exclude '*.html' --cache-control 'public, max-age=604800'
# HTML pages: always revalidate
aws s3 sync $Root "s3://$Bucket" @Excludes --exclude '*' --include '*.html' --cache-control 'no-cache' --content-type 'text/html; charset=utf-8'
# Clear the CloudFront cache
aws cloudfront create-invalidation --distribution-id $DistributionId --paths '/*' --query 'Invalidation.Id' --output text

$domain = aws cloudfront get-distribution --id $DistributionId --query 'Distribution.DomainName' --output text
Write-Host "Deployed. Open: https://$domain"
