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

## Access and privacy

- Platform owners can view and export raw JSON, IP addresses, user agents, and correlation identifiers.
- Restaurant owners and administrators can access human-readable activity and tenant-scoped technical event metadata, but raw payloads and network identifiers are removed.
- CSV values beginning with spreadsheet formula characters are escaped before download.
- CSV exports are limited to 5,000 matching rows and return truncation metadata to the UI.

## Operational review

Review this policy annually and whenever payment providers, supported countries, or legal retention requirements change.
