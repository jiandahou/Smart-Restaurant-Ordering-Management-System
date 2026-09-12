# S3 bucket for avatars / uploads

The backend stores avatars in S3 (`AvatarStorage__Provider=S3`). Create a bucket
and a dedicated IAM user, then put the user's keys into `.env.prod`.

> Region below is `ap-southeast-2` and the bucket name is `dineflow-avatars-prod`.
> Change both consistently in these JSON files and in `.env.prod` if you use others.

## 1. Create the bucket

```bash
aws s3api create-bucket \
  --bucket dineflow-avatars-prod \
  --region ap-southeast-2 \
  --create-bucket-configuration LocationConstraint=ap-southeast-2
```

## 2. Make avatar objects publicly readable

Avatars are served by URL directly from S3, so objects must be public-read.
First allow public bucket policies (turn off the two "block public policy" flags),
then apply the bucket policy:

```bash
aws s3api put-public-access-block \
  --bucket dineflow-avatars-prod \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws s3api put-bucket-policy \
  --bucket dineflow-avatars-prod \
  --policy file://deploy/aws/s3-avatars-bucket-policy.json
```

> Prefer not to expose the bucket publicly? Put a CloudFront distribution in front
> instead and set `AVATAR_STORAGE_PUBLIC_BASE_URL` to the CloudFront domain. But
> note CloudFront is one of the things you're moving away from for cost — the plain
> public bucket is the cheapest option.

## 3. CORS (browser reads)

```bash
aws s3api put-bucket-cors \
  --bucket dineflow-avatars-prod \
  --cors-configuration file://deploy/aws/s3-avatars-cors.json
```

## 4. Dedicated IAM user with least privilege

```bash
aws iam create-user --user-name dineflow-avatars-app

aws iam put-user-policy \
  --user-name dineflow-avatars-app \
  --policy-name dineflow-avatars-rw \
  --policy-document file://deploy/aws/s3-avatars-iam-policy.json

aws iam create-access-key --user-name dineflow-avatars-app
```

Copy the returned `AccessKeyId` / `SecretAccessKey` into `.env.prod`:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AVATAR_STORAGE_BUCKET=dineflow-avatars-prod
AVATAR_STORAGE_REGION=ap-southeast-2
AVATAR_STORAGE_SERVICE_URL=          # empty -> real AWS endpoint
AVATAR_STORAGE_FORCE_PATH_STYLE=false
AVATAR_STORAGE_UPLOAD_BASE_URL=https://dineflow-avatars-prod.s3.ap-southeast-2.amazonaws.com
AVATAR_STORAGE_PUBLIC_BASE_URL=https://dineflow-avatars-prod.s3.ap-southeast-2.amazonaws.com
```

## Migrating existing avatars (optional)

If the current deployment already has avatars (in MinIO or the old bucket), copy
them over so existing users keep their images:

```bash
# from MinIO (via mc) or another bucket:
aws s3 sync s3://<old-bucket> s3://dineflow-avatars-prod
```
