# Deploying the sync service

**Recommendation: Lambda behind a Function URL.** At this app's scale it costs
nothing, and there is no server to patch.

---

## Why this and not the alternatives

The service is a good fit for Lambda in a way most web apps are not: it is
stateless, every request is short, and traffic is *bursty and rare* — someone
syncs after a workout, four or five times a week. Anything that bills for
sitting idle is paying for the ~99.9% of the time nobody is lifting.

| Option | Realistic monthly floor | Why not |
|---|---|---|
| **Lambda + Function URL** | **$0** | — |
| Lambda + API Gateway | +$1.00 / million requests | Function URLs already give you HTTPS; the gateway buys nothing here |
| App Runner | ~$5–25 | Does not scale to zero |
| ECS Fargate | ~$10–15 | An always-on task for a service that is idle nearly always |
| EC2 `t4g.nano` + ALB | ~$20 | The load balancer costs five times the compute |
| EC2 + self-managed TLS | ~$4 | Cheapest that is not serverless, but now you patch a server and renew certificates |
| Lightsail | ~$5 | Same operational burden, still no scale to zero |

### What it actually costs

Lambda's free tier is **permanent**, not a 12-month trial: 1M requests and
400,000 GB-seconds every month.

At 512 MB, a sync takes roughly 200 ms → about 0.1 GB-seconds. So:

| Users | Syncs / month | Requests | GB-seconds | Cost |
|---|---|---|---|---|
| 100 | ~2,000 | 2,000 | 200 | $0 |
| 1,000 | ~20,000 | 20,000 | 2,000 | $0 |
| 10,000 | ~200,000 | 200,000 | 20,000 | $0 |

DynamoDB on demand adds $1.25 per million writes and $0.25 per million reads —
cents at these volumes. Outbound data has a 100 GB monthly free allowance.

**You will pay nothing until this is a real business.** Past the free tier it is
roughly $0.20 per million requests plus compute.

### The trade-offs, honestly

- **Cold starts.** A Node function with the AWS SDK takes roughly 300–600 ms to
  start. Sync happens in the background, so nobody sees it; sign-in is the one
  place a person is waiting, and half a second there is fine.
- **The URL is ugly** — `https://<id>.lambda-url.us-east-1.on.aws`. Fine for
  launch. A custom domain means putting CloudFront in front, which is also
  near-free at low volume.
- **6 MB payload cap.** The server's `bodyLimit` is set to match, so an
  oversized request fails with our error rather than the platform's. The client
  batches 500 rows per table, far below it.

---

## Deploying

### 1. Install and configure the AWS CLI

```bash
brew install awscli
aws configure
```

Use the IAM user you already made, or better, one with permission to create
Lambda functions and IAM roles.

### 2. Generate a production secret

Do **not** reuse the local `JWT_SECRET` — it has sat in a file on your laptop.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 3. Deploy

```bash
cd server
export JWT_SECRET='<the value from step 2>'
export APPLE_CLIENT_ID=co.workoutmaxing.app
export GOOGLE_CLIENT_ID='<your web client id>'
./scripts/deploy.sh
```

It packages the service, creates a least-privilege execution role, creates the
function and gives you an HTTPS URL. Running it again just updates the code.

### 4. Point the app at it

Put the URL — without the trailing slash — into `API_BASE_URL` in
`mobile/eas.json`, under both `preview` and `production`.

### 5. Check it

```bash
curl https://<your-url>/health
```

---

## If the Function URL returns "Forbidden"

The function is fine — confirm it with a direct invoke, which bypasses the URL
entirely:

```bash
aws lambda invoke --function-name workout-maxing-sync --region us-east-1 \
  --payload '{"version":"2.0","rawPath":"/health","requestContext":{"http":{"method":"GET","path":"/health"}},"headers":{}}' \
  /dev/stdout
```

A `{"ok":true}` back means the code, the adapter and DynamoDB all work, and only
public access to the URL is being refused.

Check, in order:

1. **Lambda → your function → Configuration → Function URL** in the console. New
   AWS accounts can have public access to function URLs blocked by default, and
   the setting is not exposed in every CLI version.
2. **Account-level Block Public Access** for Lambda, if your account has it.
3. Any SCP, if the account belongs to an organisation.

If it cannot be unblocked, put an **API Gateway HTTP API** in front instead. It
needs `AmazonAPIGatewayAdministrator` on the deploying user, and costs $1.00 per
million requests after the first year — around two cents a month at this scale.

## New accounts start at 10 concurrent executions

A fresh AWS account is capped at **10** concurrent Lambda executions rather than
the usual 1,000. That is enough for testing and nowhere near enough for launch:
sync is quick, but ten simultaneous requests is a small number of users all
finishing a workout at once. Request an increase through Service Quotas —
"Concurrent executions" — before you ship. It is free and usually granted
quickly, but it is not instant.

---

## What the running service is allowed to do

The role the script creates grants exactly four DynamoDB actions —
`Query`, `GetItem`, `UpdateItem`, `BatchWriteItem` — on the one table and its
indexes. Notably it **cannot alter the table**: the sync index is created once
by `npm run setup`, never by the server. A compromised function cannot drop an
index or change the schema.

## Why the index is not created at startup

On a long-running server, one `DescribeTable` at boot costs nothing. On Lambda
that code runs on **every cold start**, and it would mean granting the service
permission to modify the table forever in order to check a fact that changes
once in the table's lifetime. So `connect()` takes `ensureIndexExists`, and only
`npm run setup` passes it.

## Keeping cold starts down

If sign-in ever feels slow, provisioned concurrency removes cold starts — but it
bills hourly whether used or not, which defeats the point at this scale. Try
these first, in order: they are free.

- Keep the deployment package small (it is already only `src/` plus production
  dependencies).
- 512 MB is usually the sweet spot; more memory means proportionally more CPU,
  so a bigger function can be both faster *and* cheaper per request.

## Later: a custom domain

CloudFront in front of the Function URL, with a certificate from ACM. At this
traffic it stays inside CloudFront's free tier. Worth doing before launch only
if the AWS-branded URL bothers you — it is invisible to users either way.
