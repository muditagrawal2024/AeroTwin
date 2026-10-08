# Deploying AeroTwin on AWS (S3 static website + CloudFront)

AeroTwin is plain static files, so it is hosted directly from Amazon S3, with
CloudFront in front for HTTPS. HTTPS is needed for the Gamepad API.
Everything below uses the AWS console only and works on a Free plan account.

## 1. Create the bucket
**S3 → Create bucket**
- Region: Asia Pacific (Mumbai) `ap-south-1`
- Name: `aerotwin-site-<your-account-id>`
- Untick **Block all public access**, then tick the acknowledgement.
- Leave everything else as it is and click **Create bucket**.

## 2. Upload the site
Open the bucket, click **Upload**, and add:
- `index.html`, `app.html`, `sim.html`, `view.html`, `404.html`
- the `assets` folder

Do **not** upload `deploy/`, `docs/`, `README.md`, `LICENSE` or `.gitignore`.

## 3. Turn on static website hosting
**Properties → Static website hosting → Edit**
- Enable
- Index document: `index.html`
- Error document: `404.html`

## 4. Allow public read
**Permissions → Bucket policy → Edit**:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::aerotwin-site-<your-account-id>/*"
  }]
}
```

The site now works at the **Bucket website endpoint** shown under
Properties, for example
`http://aerotwin-site-123456789012.s3-website.ap-south-1.amazonaws.com`.

## 5. Add HTTPS with CloudFront
**CloudFront → Create distribution**
- If a pricing plan is offered, pick **Free**.
- Origin: your bucket. Accept **Use website endpoint**.
- Viewer protocol policy: **Redirect HTTP to HTTPS**
- Default root object: `index.html`
- Web Application Firewall: **do not enable**

Wait until the deployment finishes, then use `https://<distribution>.cloudfront.net`.

After changing files in S3, go to **CloudFront → Invalidations → Create** and enter `/*`.

## Teardown after the demo
1. **CloudFront:** select the distribution and click **Disable**. When it is disabled, click **Delete**. If you chose a flat-rate plan, cancel the plan first.
2. **S3:** select the bucket, click **Empty** (type `permanently delete`), then click **Delete** (type the bucket name).
3. **Billing → Bills:** confirm the total is $0.

## AWS services used
| Service | Purpose |
| --- | --- |
| Amazon S3 | Stores and serves the site files (static website hosting) |
| Amazon CloudFront | HTTPS, edge caching and compression |
| AWS IAM (bucket policy) | Grants public read on the site files only |

`deploy/cloudformation.yaml` is an alternative that creates a private bucket
with CloudFront Origin Access Control in one step. It needs an account that is
allowed to create CloudFront distributions through CloudFormation.
