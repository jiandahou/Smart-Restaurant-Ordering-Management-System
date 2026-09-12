# Deploying DineFlow to AWS EC2

Production stack: **Postgres (Docker) + .NET 8 API + nginx-served React build + Cloudflare Tunnel**, with avatars/files on **AWS S3**. No inbound ports are opened — Cloudflare Tunnel handles ingress.

This replaces the current setup, where the frontend ran `npm run dev` (a Vite **dev server**) exposed through a tunnel from a local machine. The fix is a real production build served by nginx; the backend Dockerfile was already production-grade.

```
Internet ──► Cloudflare ──► cloudflared (in EC2) ──► frontend (nginx :80) ──► backend (:8080) ──► postgres
                                              └────► backend (:8080)              backend ──► AWS S3 (avatars)
   demo/control-dineflow  → frontend            api-dineflow → backend
```

---

## 0. What you need first

- An **EC2 instance**: Ubuntu 22.04/24.04, `t3.small` (x86) or `t4g.small` (ARM, cheaper). 2 GB RAM is enough with S3 (no MinIO). Give it ~20–30 GB gp3 EBS.
  - **Security group**: allow **outbound all**; inbound only **SSH (22)** from your IP. No 80/443 needed — the tunnel dials out.
- An **S3 bucket** (e.g. `dineflow-avatars-prod`) in your region, plus an **IAM user** with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on it. Enable public-read so avatar URLs load in the browser. Ready-to-apply JSON + commands: [`deploy/aws/README-s3.md`](aws/README-s3.md).
- Your existing **Cloudflare tunnel credentials** file from `C:\Users\mr\.cloudflared\16f95d76-7fd8-4604-be21-ba71e2bfe302.json`.

> Reusing the existing tunnel means the DNS records already point at it — **no DNS changes**. Just make sure the tunnel is **not** also running on your Windows machine at the same time.

---

## 1. Bootstrap the instance

SSH in, then install Docker:

```bash
bash deploy/ec2-bootstrap.sh
```

Log out and back in so `docker` works without `sudo`.

## 2. Get the code

```bash
git clone <your-repo-url> "Smart Restaurant Ordering System"
cd "Smart Restaurant Ordering System"
```

## 3. Configure secrets

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Generate strong secrets:

```bash
openssl rand -base64 48   # -> JWT_SECRET_KEY
openssl rand -base64 24   # -> POSTGRES_PASSWORD
openssl rand -base64 24   # -> SEED_OWNER_PASSWORD
```

Fill in Stripe keys, Resend key, and the S3 bucket/region + IAM `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

## 4. Add the Cloudflare tunnel credentials

Copy the JSON up (from your laptop):

```bash
scp C:\Users\mr\.cloudflared\16f95d76-7fd8-4604-be21-ba71e2bfe302.json \
    ubuntu@<ec2-ip>:"~/Smart Restaurant Ordering System/deploy/cloudflared/"
```

(`deploy/cloudflared/config.yml` already references this filename and routes the three hostnames to the containers.)

## 5. Launch

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The backend **auto-runs EF migrations and seeds the owner account** on startup — no manual migration step.

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f backend cloudflared
```

## 6. Verify

```bash
curl -s https://api-dineflow.theunknownfish.com/health        # {"status":"ok",...}
curl -sI https://demo-dineflow.theunknownfish.com | head       # 200, no /src/*.tsx requests
```

Open `https://demo-dineflow.theunknownfish.com` — view source should show a hashed `/assets/*.js` bundle, **not** `/@vite/client` or `/src/...tsx`. That confirms you're on the production build.

---

## Continuous deployment (optional)

`.github/workflows/deploy-ec2.yml` deploys the whole stack to the instance over SSH
(`git reset --hard` to the pushed commit, then `docker compose ... up -d --build`).

Set these repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `EC2_HOST` | instance public IP/hostname |
| `EC2_USER` | ssh user, e.g. `ubuntu` |
| `EC2_SSH_KEY` | the PEM private key for that user |
| `EC2_APP_DIR` | repo path on the box, e.g. `/home/ubuntu/Smart Restaurant Ordering System` |

It's **manual (`workflow_dispatch`)** by default. To auto-deploy on push, uncomment
the `push:` block in the workflow — but do that only after retiring the old AWS
workflows (below), so two pipelines don't fight.

## Retiring the old (expensive) AWS stack

This repo already had a Fargate/ECS + S3/CloudFront pipeline:
`backend-cd.yml` (ECR → **ECS Fargate**) and `frontend-cd.yml` (S3 + **CloudFront**).
Fargate running 24/7 is the pricey part. Once the EC2 stack is verified healthy:

1. Confirm the domains (`demo/control/api-dineflow`) resolve to the **EC2 tunnel**, not CloudFront/ECS.
2. Disable or delete `.github/workflows/backend-cd.yml` and `frontend-cd.yml`.
3. In AWS: set the **ECS service** desired count to 0 (or delete the service), then tear down its **ALB/Fargate** resources; delete the **CloudFront** distribution and the frontend-hosting S3 bucket if unused; if you were on **RDS**, snapshot then delete it (the EC2 stack uses a dockerized Postgres instead).
4. Keep the **avatars S3 bucket** — the EC2 stack still uses it.

> Double-check nothing else references the ECS endpoint before deleting it.

## Day-2 operations

**Update to latest code**
```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

**Backup the database** (data lives in the `dineflow_postgres_data` volume)
```bash
docker exec dineflow-postgres pg_dump -U dineflow_user dineflow_db | gzip > backup-$(date +%F).sql.gz
```

**Restore**
```bash
gunzip -c backup-YYYY-MM-DD.sql.gz | docker exec -i dineflow-postgres psql -U dineflow_user -d dineflow_db
```

**Logs / status**
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f <service>
```

**Stripe webhooks** — point your Stripe dashboard webhook at
`https://api-dineflow.theunknownfish.com/api/payments/stripe/webhook`
and put the signing secret in `STRIPE_WEBHOOK_SECRET`.

---

## Cost notes

- `t4g.small` on-demand ≈ **US$12/mo** (cheaper with a 1-yr Savings Plan), + ~US$2–3 for a 30 GB gp3 volume.
- S3 at this scale is a few cents/month. Cloudflare Tunnel is free.
- Cheapest single-box footprint: everything on one instance, Postgres data on the EBS volume (snapshot it for backups).
- If you later need managed DB reliability, switch `postgres` for **RDS**: drop the `postgres` service and point `ConnectionStrings__DefaultConnection` at the RDS endpoint.
