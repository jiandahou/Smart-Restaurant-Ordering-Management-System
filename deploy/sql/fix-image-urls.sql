-- Fix legacy image/avatar URLs that were stored with an absolute localhost base.
--
-- Some MenuItems.ImageUrl and AspNetUsers.AvatarUrl rows were seeded/uploaded with
-- "http://localhost:9000/dineflow-avatars-local/..." baked in. Over HTTPS these are
-- mixed-content and fail to load. This rewrites the host prefix to the public base.
--
-- Idempotent: only rows matching the old prefix are touched; re-running is a no-op.
--
-- Usage (defaults to the stage api-dineflow base):
--   PW=$(docker exec dineflow-postgres printenv POSTGRES_PASSWORD)
--   docker exec -e PGPASSWORD="$PW" -i dineflow-postgres \
--     psql -U dineflow_user -d dineflow_db < deploy/sql/fix-image-urls.sql
--
-- Override the target base (e.g. an S3 bucket URL on EC2):
--   ... psql -U dineflow_user -d dineflow_db \
--     -v new_prefix='https://dineflow-avatars-prod.s3.ap-southeast-2.amazonaws.com/dineflow-avatars-local' \
--     < deploy/sql/fix-image-urls.sql

\set ON_ERROR_STOP on

-- Default target base, applied only when -v new_prefix=... was not passed.
\if :{?new_prefix}
\else
  \set new_prefix 'https://api-dineflow.theunknownfish.com/dineflow-avatars-local'
\endif

\echo 'Target base prefix:' :new_prefix

BEGIN;

-- Report BEFORE
\echo '--- before ---'
SELECT 'MenuItems.ImageUrl'   AS col, count(*) AS to_fix FROM "MenuItems"   WHERE "ImageUrl"  LIKE 'http%://localhost:9000/dineflow-avatars-local%'
UNION ALL
SELECT 'AspNetUsers.AvatarUrl', count(*) FROM "AspNetUsers" WHERE "AvatarUrl" LIKE 'http%://localhost:9000/dineflow-avatars-local%'
UNION ALL
SELECT 'Restaurants.ImageUrl', count(*) FROM "Restaurants" WHERE "ImageUrl"  LIKE 'http%://localhost:9000/dineflow-avatars-local%';

-- Rewrite both http:// and https:// localhost variants -> new prefix
UPDATE "MenuItems"
   SET "ImageUrl" = :'new_prefix' || substring("ImageUrl" from position('/dineflow-avatars-local' in "ImageUrl") + length('/dineflow-avatars-local'))
 WHERE "ImageUrl" LIKE 'http%://localhost:9000/dineflow-avatars-local%';

UPDATE "AspNetUsers"
   SET "AvatarUrl" = :'new_prefix' || substring("AvatarUrl" from position('/dineflow-avatars-local' in "AvatarUrl") + length('/dineflow-avatars-local'))
 WHERE "AvatarUrl" LIKE 'http%://localhost:9000/dineflow-avatars-local%';

UPDATE "Restaurants"
   SET "ImageUrl" = :'new_prefix' || substring("ImageUrl" from position('/dineflow-avatars-local' in "ImageUrl") + length('/dineflow-avatars-local'))
 WHERE "ImageUrl" LIKE 'http%://localhost:9000/dineflow-avatars-local%';

-- Report AFTER
\echo '--- after (remaining localhost rows, should all be 0) ---'
SELECT 'MenuItems.ImageUrl'   AS col, count(*) AS remaining FROM "MenuItems"   WHERE "ImageUrl"  LIKE 'http%://localhost:9000%'
UNION ALL
SELECT 'AspNetUsers.AvatarUrl', count(*) FROM "AspNetUsers" WHERE "AvatarUrl" LIKE 'http%://localhost:9000%'
UNION ALL
SELECT 'Restaurants.ImageUrl', count(*) FROM "Restaurants" WHERE "ImageUrl"  LIKE 'http%://localhost:9000%';

COMMIT;
