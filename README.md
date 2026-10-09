# AeroTwin: Amazon S3, simulated, with a drone that fills the buckets

AeroTwin is a website that **simulates Amazon Simple Storage Service (S3)**.
It runs entirely in the browser and implements the core behaviour of S3:
buckets, objects, versioning, storage classes, lifecycle rules, access
control, presigned URLs, event notifications and billing.

As its **enhancement**, AeroTwin adds a real-time **drone flight simulator**
that acts as a live data producer. Every flight uploads its telemetry log,
gimbal-camera photos and videos, and Blockly mission files to the simulated
S3 buckets, and those flights can be replayed in 3D straight from S3.

**Live site:** _add your CloudFront / S3 website URL here_
**Course:** BCSE355L Cloud Architecture Design, Digital Assignment 3 (AWS Service Simulation & Enhancement)

---

## 1. The AWS service: Amazon S3

S3 is object storage. You store **objects** (any file plus metadata) under a
**key** inside a **bucket**, and read them back over HTTPS. Each bucket lives
in one region and carries settings that apply to everything inside it:
versioning, default encryption, public-access controls, lifecycle rules and
event notifications. You pay per GB-month stored (the price depends on the
storage class), per request, and per GB transferred out.

**Request workflow in S3, and in AeroTwin:**
1. A client (the console, the CLI or the drone) calls an operation such as `PutObject` with a bucket and key.
2. Access is checked: Block Public Access, the bucket policy, or a presigned URL's SigV4 signature.
3. The object is encrypted (SSE-S3), given an MD5 ETag and a version ID, and stored in its storage class.
4. Side effects follow: event notifications invoke functions, the request is logged and billed, and lifecycle rules later move or expire the object.

## 2. Core functionality simulated

| S3 feature | In AeroTwin |
| --- | --- |
| Buckets | Create and delete buckets with the real naming rules, choose a region, tags, a non-empty-bucket check. |
| Objects | Upload (drag and drop), download, delete, copy, folders via the `/` delimiter, metadata, MD5 ETags, multipart upload over 5 MB with `-N` ETags. |
| Versioning | Enabled and Suspended states, delete markers, version list, restoring an old version, permanent version delete. |
| Storage classes | Standard, Standard-IA, Glacier Instant Retrieval, Glacier Flexible Retrieval, Deep Archive. Archived objects need `RestoreObject` before `GetObject`. |
| Lifecycle | Transition and expiration rules with prefix filters and noncurrent-version expiry, evaluated whenever the simulated clock moves. |
| Security | Block Public Access, JSON bucket policies with validation and an evaluator (explicit Deny wins), and SSE-S3 using real AES-256-GCM. |
| Sharing | Public object URLs and presigned URLs signed with the real AWS Signature Version 4 key derivation, with expiry. An endpoint emulator returns S3-style XML errors. |
| Events | `s3:ObjectCreated:*` and `s3:ObjectRemoved:*` notifications with prefix and suffix filters, delivered to a Lambda-style `flight-indexer` function. |
| Billing | GB-month metering per storage class, PUT and GET request tiers, retrieval and transfer-out fees, free tier, monthly budget alert and forecast. |
| Interfaces | A web console, an AWS CLI emulator (`aws s3 ls/cp/mv/rm/mb/rb/presign`, `aws s3api …`, `aws ce get-cost-and-usage`) and a CloudTrail-style activity log. |

## 3. Enhancements beyond plain S3

1. **A live data producer.** A three.js drone simulator that writes real objects into S3:
   - `aerotwin-flight-logs/logs/YYYY/MM/DD/FLT-….json` after every landing or crash
   - `aerotwin-drone-media/photos/…png` and `videos/…webm` from the gimbal camera
   - `aerotwin-missions/…xml` for Blockly missions, versioned like source code
2. **Three ways to fly.** Keyboard with a Mode 2 transmitter layout, any gamepad (Web Gamepad API), and block-based missions with loops, functions, variables, sensors and S3 blocks.
3. **Replay from storage.** Any flight log is read back with `GetObject` and replayed as a ghost drone. Logs that lifecycle moved to Glacier fail with `InvalidObjectState` until they are restored, which demonstrates the trade-off of archiving.
4. **Time travel.** A simulated clock moves 1 hour to 90 days ahead to show lifecycle transitions, Glacier restore delays and presigned-URL expiry.
5. **Cost insight.** A month-to-date cost meter in the header, a budget alert, and a what-if calculator that projects a year of drone-fleet storage with and without lifecycle tiering.

## 4. Demo script (5 minutes)

1. **Overview page:** buckets, objects, storage by class, latest API calls.
2. **Buckets → aerotwin-flight-logs → Management:** show the `tier-flight-logs` rule.
3. **Clock in the top bar, +90 days:** the rule moves logs to Standard-IA and Glacier.
4. **Open an archived log:** `GetObject` fails, so click **Initiate restore**, move the clock +1 day, and it can be read again.
5. **aerotwin-public-gallery → Permissions:** run the policy simulator, then open the public URL. `shared/` loads and `private/` returns `AccessDenied` XML.
6. **Any object → Generate presigned URL:** show the signing steps, then open the URL.
7. **AWS CLI page:** `aws s3 ls`, `aws s3api list-object-versions --bucket aerotwin-missions`.
8. **Drone simulator:** press Space to take off, fly with the keys, press P for a photo, press Space to land. The upload feed shows `PUT 200`, and the flight appears in the console via the event notification.
9. **Billing:** request counts and storage charges, the budget alert, and the fleet calculator.

## 5. Run locally

Plain static files, no build step. Serve the folder over HTTP:

```bash
python -m http.server 8000
# open http://localhost:8000
```

## 6. Deployment on AWS

The site is hosted on real AWS: the files are in an **Amazon S3** bucket with
static website hosting. See
[docs/DEPLOY_AWS.md](docs/DEPLOY_AWS.md) for the step-by-step console guide
and teardown.
http://aerotwin-site-620503470209.s3-website.ap-south-1.amazonaws.com

## 7. Project structure

```
index.html          landing page
app.html            S3 console (single-page app)
view.html           S3 endpoint emulator for public and presigned URLs
sim.html            drone simulator
404.html            error page
assets/js/core/     s3.js (S3 engine), policy.js, pricing.js, md5.js, seed.js, ui.js, util.js
assets/js/console/  console router and views (buckets, bucket, object, billing, cli, activity, about)
assets/js/sim/      world, drone model, flight physics, input, autopilot, Blockly missions, recorder, main loop
assets/vendor/      three.js r124, Google Blockly 10
deploy/             optional CloudFormation template and deploy scripts
docs/               AWS deployment guide
```

## 8. Credits

Built by Mudit (VIT Chennai). The drone part reuses ideas and code from two MIT-licensed projects:
[Drone Commander](https://github.com/vroby65/DroneCommander) by vroby65 (Blockly command set and arc maths) and
[Drone Simulator](https://github.com/MSubham06/Drone_Simulator) by Subham (gamepad mapping and motor sound).
It also uses [three.js](https://threejs.org) (MIT), [Google Blockly](https://developers.google.com/blockly) (Apache 2.0), and the Archivo and B612 Mono fonts (SIL OFL).
