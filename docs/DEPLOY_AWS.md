# Hosting AeroTwin on AWS

AeroTwin is a static website: HTML, CSS, JavaScript and a few libraries, with
no server code. That makes it a natural fit for **Amazon S3** (storage for the
files) behind **Amazon CloudFront** (HTTPS, caching at edge locations close to
visitors). The site itself does not depend on AWS; any static host would work.

```
Visitor ──HTTPS──▶ CloudFront edge (cache, gzip/brotli, HTTP/2+3)
                        │  signed request (Origin Access Control)
                        ▼
                  S3 bucket (private, encrypted, versioned)
```

| AWS service | What it does for AeroTwin |
| --- | --- |
| Amazon S3 | Stores every site file. The bucket stays private (Block Public Access on), is encrypted with SSE-S3 and keeps versions so a bad upload can be rolled back. |
| Amazon CloudFront | Serves the site over HTTPS from edge locations, compresses JavaScript, caches assets and returns the custom 404 page. |
| Origin Access Control | Lets only this CloudFront distribution read the bucket, so S3 is never exposed directly. |
| AWS CloudFormation | Creates all of the above from one template (`deploy/cloudformation.yaml`) and deletes it again in one step. |
| AWS IAM | The user or role that runs the deploy needs S3 and CloudFront permissions. |

---

## Option A: CloudFormation + CLI (recommended, about 10 minutes)

Prerequisites: an AWS account, the [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and `aws configure` done with an access key.

1. **Create the stack** (pick your own unique bucket name):

   ```bash
   aws cloudformation deploy \
     --stack-name aerotwin-site \
     --template-file deploy/cloudformation.yaml \
     --parameter-overrides BucketName=aerotwin-site-<yourname> \
     --region ap-south-1
   ```

   CloudFront takes 3–5 minutes to finish creating.

2. **Read the outputs** (bucket name, distribution ID and the site URL):

   ```bash
   aws cloudformation describe-stacks --stack-name aerotwin-site --region ap-south-1 \
     --query "Stacks[0].Outputs" --output table
   ```

3. **Upload the site**:

   - macOS / Linux / Git Bash: `./deploy/deploy.sh aerotwin-site-<yourname> <DistributionId>`
   - Windows PowerShell: `.\deploy\deploy.ps1 -Bucket aerotwin-site-<yourname> -DistributionId <DistributionId>`

   The script uploads assets with a one-week cache, HTML with `no-cache`, then
   invalidates CloudFront so the new version is live immediately.

4. Open the `WebsiteURL` output, for example `https://d1234abcd.cloudfront.net`.

To publish changes later, just run step 3 again.

## Option B: AWS Management Console only

1. **S3 → Create bucket** in `ap-south-1`. Keep *Block all public access* ticked, enable *Bucket Versioning*, keep default SSE-S3 encryption.
2. Open the bucket → **Upload** → drag in everything from this folder except `deploy/`, `docs/`, `.github/` and the Markdown files. Keep the folder structure (`assets/...`).
3. **CloudFront → Create distribution**
   - Origin domain: choose your bucket.
   - Origin access: *Origin access control settings (recommended)* → *Create new OAC*.
   - Viewer protocol policy: *Redirect HTTP to HTTPS*.
   - Cache policy: *CachingOptimized*.
   - Default root object: `index.html`.
   - Create the distribution, then click **Copy policy** in the yellow banner.
4. Back in **S3 → your bucket → Permissions → Bucket policy**, paste the copied policy and save.
5. **CloudFront → Error pages → Create custom error response** for 403 and 404 → `/404.html` with response code 404.
6. Wait until the distribution status is *Enabled*, then open its domain name.

## Option C: GitHub Actions (deploy on every push)

`deploy/github-actions-deploy.yml` runs the same sync and invalidation. Copy it to `.github/workflows/deploy-aws.yml` in your repository to turn it on. Add
these repository secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_REGION` (for example `ap-south-1`), `S3_BUCKET` and `CLOUDFRONT_DISTRIBUTION_ID`.

## Cost

For a class project the bill is effectively zero:

- S3 Standard storage for ~2 MB of site files costs well under one US cent per month.
- CloudFront's always-free tier includes 1 TB of data transfer out and 10 million HTTPS requests per month.
- CloudFormation is free; invalidations are free for the first 1,000 paths per month.

Set an **AWS Budgets** alert (for example $1/month) as a safety net.

## Taking it down

```bash
aws s3 rm s3://aerotwin-site-<yourname> --recursive
aws s3api delete-objects --bucket aerotwin-site-<yourname> \
  --delete "$(aws s3api list-object-versions --bucket aerotwin-site-<yourname> \
  --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json)"
aws cloudformation delete-stack --stack-name aerotwin-site --region ap-south-1
```

(The bucket must be empty, including old versions, before the stack can delete it.)

## Notes

- Flights, photos and missions are stored in each visitor's browser (IndexedDB), so hosting needs no database or backend.
- Fonts load from Google Fonts; everything else (three.js, Blockly) is served from the bucket itself.
- `404.html` uses absolute paths so it renders correctly for any missing URL.
