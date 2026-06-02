# AWS Staging Deployment Checklist

## Goal

Deploy DineFlow staging with:

- Backend API on AWS App Runner
- Backend Docker image stored in Amazon ECR
- PostgreSQL database on Amazon RDS
- Frontend deployed separately using Vercel, Netlify, or S3 + CloudFront

## Architecture

```text
GitHub Actions
  -> build backend Docker image
  -> push image to Amazon ECR
  -> trigger AWS App Runner deployment
  -> backend connects to Amazon RDS PostgreSQL

Frontend hosting
  -> Vercel / Netlify / S3 + CloudFront
  -> calls App Runner backend URL
```

## AWS Resources

### Amazon ECR

- Repository name: `dineflow-backend`
- Image tags:
  - `latest`
  - Git commit SHA
- Purpose: store backend Docker images built by GitHub Actions.

### Amazon RDS PostgreSQL

- Engine: PostgreSQL
- Environment: staging
- Database name: `dineflow_db`
- Username: `dineflow_user`
- Public access: `No` for normal staging
- Storage: 20 GB to start
- Backups: enabled if budget allows

Record these values after creation:

```text
RDS_ENDPOINT=
RDS_PORT=5432
RDS_DATABASE=dineflow_db
RDS_USERNAME=dineflow_user
RDS_PASSWORD=
```

### AWS App Runner

- Service name: `dineflow-backend-staging`
- Source: ECR image
- Container port: `8080`
- Health check path: `/health/ready`
- Runtime:
  - `ASPNETCORE_ENVIRONMENT=Staging`
  - `ASPNETCORE_URLS=http://+:8080`

Record these values after creation:

```text
APP_RUNNER_BACKEND_SERVICE_ARN=
APP_RUNNER_BACKEND_URL=
```

## Required Backend Environment Variables

Set these in App Runner:

```text
ASPNETCORE_ENVIRONMENT=Staging
ASPNETCORE_URLS=http://+:8080

ConnectionStrings__DefaultConnection=Host=<RDS_ENDPOINT>;Port=5432;Database=dineflow_db;Username=dineflow_user;Password=<RDS_PASSWORD>

Jwt__Issuer=DineFlow.Api
Jwt__Audience=DineFlow.Client
Jwt__SecretKey=<long-random-secret>
Jwt__ExpirationMinutes=60

FRONTEND_BASE_URL=<frontend-staging-url>

Email__From=<sender-email>
Email__Server=<smtp-server-url-if-used>
Email__ResendApiKey=<resend-api-key-if-used>

Authentication__Google__ClientId=<google-client-id>
Authentication__Google__ClientSecret=<google-client-secret>
Authentication__Google__CallbackPath=/api/auth/google/signin

Passkeys__ServerDomain=<backend-domain-without-scheme>
Passkeys__ServerName=DineFlow
Passkeys__Origins__0=<frontend-staging-url>

Stripe__SecretKey=<stripe-secret-key>
Stripe__PublishableKey=<stripe-publishable-key>
Stripe__WebhookSecret=<stripe-webhook-secret>
Stripe__Currency=aud
Stripe__SuccessUrl=<frontend-staging-url>/payment/success
Stripe__CancelUrl=<frontend-staging-url>/payment/cancelled

SeedOwner__Email=<staging-owner-email>
SeedOwner__Password=<staging-owner-password>
SeedOwner__FullName=DineFlow Owner
```

## GitHub Secrets

Add these repository secrets in GitHub:

```text
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_ACCOUNT_ID=
ECR_BACKEND_REPOSITORY=dineflow-backend
APP_RUNNER_BACKEND_SERVICE_ARN=
```

Optional frontend/deployment secrets:

```text
FRONTEND_STAGING_URL=
BACKEND_STAGING_URL=
```

## Manual Setup Steps

1. Choose an AWS region, such as `ap-southeast-2`.
2. Create the ECR repository `dineflow-backend`.
3. Create the RDS PostgreSQL database.
4. Build and push one initial backend Docker image to ECR, or use the CD workflow after it exists.
5. Create the App Runner service from the ECR backend image.
6. Set all required backend environment variables in App Runner.
7. Add GitHub repository secrets.
8. Run the backend CD workflow.
9. Verify the backend health endpoints.
10. Deploy the frontend separately and point it at the App Runner backend URL.

## Health Checks

Backend liveness:

```text
GET /health
```

Backend and database readiness:

```text
GET /health/ready
```

Expected staging checks:

```text
curl https://<app-runner-url>/health
curl https://<app-runner-url>/health/ready
```

## Stripe Staging Setup

After the backend URL is available, create a Stripe webhook endpoint:

```text
https://<app-runner-url>/api/payments/stripe/webhook
```

Listen for at least:

- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.payment_failed`

Copy the Stripe webhook signing secret into:

```text
Stripe__WebhookSecret=<whsec_...>
```

## Google OAuth Staging Setup

Add these authorized redirect URIs in Google Cloud Console:

```text
https://<app-runner-url>/api/auth/google/signin
```

If frontend uses an OAuth exchange callback page, also add the frontend staging callback URL used by the app.

## Passkey Staging Setup

Passkeys require the relying party domain and allowed origins to match staging domains:

```text
Passkeys__ServerDomain=<backend-domain-without-scheme>
Passkeys__Origins__0=<frontend-staging-url>
```

For custom domains, update these values after DNS is configured.

## Follow-up Tickets

- CD: push backend Docker image to ECR
- CD: deploy backend to App Runner
- Frontend CD: deploy Vite app
- Staging: configure custom domain and HTTPS
- Staging: configure Stripe webhook endpoint
- Staging: configure Google OAuth redirect URIs
- Staging: configure App Runner/RDS network access
- Observability: App Runner logs and request tracing
