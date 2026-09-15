# Reporting and audit retention policy

## Purpose

DineFlow keeps two reporting layers:

- **Business activity** is a human-readable projection used by restaurant operators.
- **Technical audit, order events, and payment events** are append-only evidence used for investigations, reconciliation, and support.

The business activity feed does not replace or mutate the technical records. It is derived from them.

## Retention periods

| Record type | Retention | Reason |
| --- | ---: | --- |
| Audit events | 2,555 days (7 years) | Administrative and security evidence |
| Payment and refund events | 2,555 days (7 years) | Financial reconciliation and dispute support |
| Order events | 730 days (2 years) | Operational history and customer support |
| Active carts | Up to 24 hours after expiry, then deletion | Checkout recovery only |
| Authentication refresh tokens | Until expiry/revocation plus 30 days | Account security investigation |
| Privacy requests | 7 years after closure | Evidence of request handling |
| Avatars and OAuth profile copies | Account lifetime, then deletion within 30 days unless a hold applies | User profile only |
| Production backups | 35 days rolling | Disaster recovery |

Retention values are exposed by `GET /api/admin/reports/policy` so the Reports UI and exports can state the active policy.

## Integrity

Report tables are append-only in both the EF Core change tracker and PostgreSQL triggers. Application code must not update or delete individual report rows.

Before automated archival is enabled in production, the archive destination must provide:

1. encrypted storage;
2. tenant-separated object paths;
3. a manifest containing row counts, minimum and maximum timestamps, and a SHA-256 checksum;
4. a restore drill with documented recovery time;
5. legal approval for the deployment country.

After a verified archive is written, retention deletion must run through a dedicated database role and an audited maintenance procedure. The application runtime role must remain unable to mutate report rows.

### The maintenance task

Retention runs as its own process, not inside the API — a hosted service would need exactly the
grant this policy withholds from the web runtime.

```bash
# Archive and report, delete nothing. Run this first against a new archive destination.
dotnet DineFlow.Api.dll --retention --dry-run

# Archive, verify the archive against its manifest, then delete what is past its period.
dotnet DineFlow.Api.dll --retention

# Read every archive back and check it against its manifest. Exits non-zero if any fail.
dotnet DineFlow.Api.dll --retention-restore-drill
```

`ReportRetention__ArchiveDestination` is the directory the archives are written to. It is a mounted
path rather than an object-store client so that bucket credentials never enter the process; the
deployment is responsible for that mount being encrypted and lifecycle-managed, and for scheduling
the task above.

Each run writes, for every record type, a `.jsonl` archive and a `.manifest.json` beside it carrying
the row count, the earliest and latest timestamps, and a SHA-256 checksum. The archive is read back
and checked against its manifest **before** anything is deleted; a mismatch leaves the rows in place.

Deletion declares itself to the database (`SET LOCAL "dineflow.retention_maintenance" = 'on'`), which
the immutability trigger requires. That is a statement of intent, not a permission — the permission
boundary remains the `GRANT`, and the web runtime's role must not have `DELETE` on the report tables.
`UPDATE` stays refused unconditionally: retention removes evidence whose period has run out, it never
edits it.

### Legal holds

Holds live in the `LegalHolds` table and are honoured by the maintenance task. A hold names a record
type and optionally a restaurant and an order; a null at either level widens the scope rather than
narrowing it. Held rows are reported as `held` in the run output and are not archived or deleted
until the hold is released. Releasing a hold records who released it and when — released holds are
kept, not deleted.

### Production configuration gate

The API refuses to start in `Production` unless all of the following external-maintenance evidence is configured:

- `ReportRetention__ExternalMaintenanceEnabled=true`;
- `ReportRetention__ScheduledJobReference` identifies the deployed scheduler/task revision;
- `ReportRetention__ArchiveDestination` identifies the encrypted, lifecycle-managed archive;
- `ReportRetention__LegalHoldRegister` identifies the approved hold/release register;
- `ReportRetention__LastRestoreDrillUtc` records a successful drill no more than one year old.

These settings are evidence references, not maintenance credentials. The web runtime must not receive the dedicated database role or archive writer credentials. When the gate is not satisfied in a non-production environment, the Reports UI labels the number as **Policy only** rather than implying that deletion and archival are running.

Before setting the gate to enabled, operations must attach the scheduler execution log, archive manifest/checksum, object-store encryption and lifecycle settings, current legal holds, deletion audit, and restore-drill result to the release record. A configuration value without those artefacts is not acceptance evidence.

## Access and privacy

- Platform owners can view and export raw JSON, IP addresses, user agents, and correlation identifiers.
- Restaurant owners and administrators can access human-readable activity and tenant-scoped technical event metadata, but raw payloads and network identifiers are removed.
- CSV values beginning with spreadsheet formula characters are escaped before download.
- CSV exports are limited to 5,000 matching rows and return truncation metadata to the UI.

## Operational review

Review this policy annually and whenever payment providers, supported countries, or legal retention requirements change.

Retention must be enforced by scheduled jobs and backup lifecycle rules, not only documented. Legal holds for disputes, chargebacks, investigations or statutory recordkeeping must be scoped, approved, logged and released. Where a record no longer needs to identify a customer, deletion or irreversible de-identification is preferred to indefinite retention.
