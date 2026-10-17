# Object storage integration test

The regular Docker Compose smoke test checks that the API starts and connects to
PostgreSQL. Its `/health/ready` endpoint does not check S3, so that job uses the
disposable `docker-compose.ci.yml` stack and does not pull MinIO images.

The separate **S3 Object Storage Integration** GitHub Actions workflow checks a
real, private AWS S3 test bucket. It is manual (`workflow_dispatch`) until the
test AWS resources are provisioned. Never point it at the live avatar bucket.

## One-time AWS/GitHub setup

1. Create a new, private S3 bucket named `dineflow-ci-<unique-suffix>` in the
   chosen AWS region. Enable **Block all public access**. Keep versioning off
   for this disposable test bucket unless the script is extended to remove and
   verify object versions. Do not copy live objects into it.
2. Create a GitHub OIDC IAM role trusted only by this repository's
   `s3-integration` GitHub environment. Limit the trust policy to the exact
   repository/environment subject and `sts.amazonaws.com` audience. The
   environment may require a reviewer. Do not give the role access to the live
   avatar bucket or use long-lived AWS access keys.
3. Attach only these S3 permissions to that role, substituting the exact bucket:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
         "Resource": "arn:aws:s3:::dineflow-ci-<unique-suffix>/ci/dineflow-storage/*"
       },
       {
         "Effect": "Allow",
         "Action": "s3:ListBucket",
         "Resource": "arn:aws:s3:::dineflow-ci-<unique-suffix>"
       }
     ]
   }
   ```

4. In GitHub, create the `s3-integration` environment and add these
   environment variables (not repository-wide production settings):
   `S3_TEST_ROLE_ARN`, `S3_TEST_ACCOUNT_ID` (12 digits), `S3_TEST_REGION`,
   and `S3_TEST_BUCKET`.
5. Run **Actions → S3 Object Storage Integration → Run workflow**. The job
   uploads one random text object, reads it back byte-for-byte, confirms an
   unsigned read receives 403, deletes the object, and confirms a signed HEAD
   receives 404. The script also attempts cleanup if an earlier assertion fails.

The test refuses a bucket without the `dineflow-ci-` prefix, a mismatched AWS
account, or a bucket equal to `AVATAR_STORAGE_BUCKET` when that variable is
provided. The IAM policy is the main protection against touching live data.

To run the same check locally with an approved short-lived AWS profile, set
the four `S3_TEST_*` variables, select that profile, and run
`bash scripts/test-s3-storage.sh`. Do not paste credentials into chat or a
tracked `.env` file.

This tests S3 API operations and private-bucket policy. It does **not** test
browser CORS, presigned upload URLs, CloudFront/public image delivery, or the
application's image-processing flow; those need separate application-level
acceptance tests before relying on them for live uploads.
