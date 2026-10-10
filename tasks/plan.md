# Attendance Workspace implementation plan

A separate, public, self-hosted attendance application derived from the current club project. Each deployment serves one organization and owns its own D1 database. The source repository and live club deployment remain untouched.

## Acceptance criteria and sequence
1. General setup and configuration: neutral assets, no fixed people or email domain, a single first owner chosen by the installer, atomic one-time bootstrap, optional email domain allowlist, own database placeholder. Verify with setup/auth API tests and a fresh migrated local database.
2. Reliability and efficiency: inspect current query and import behavior, measure bottlenecks before optimizing, fix bounded import processing and expensive repeated roster queries without altering role access. Verify regression tests, representative benchmark, build and browser smoke tests.
3. Public project packaging: comprehensive README and deployment/user/architecture/security documentation, license, synthetic examples, CI checks, screenshots from synthetic local data. Review tracked files for credentials and club identifiers, commit and push to a new public GitHub repository.

## Decisions
- Name: attendance-workspace, avoiding the existing attendance-tracker desktop repository.
- One organization per installation; no public signup or shared multi-tenant SaaS.
- Keep Workers/D1 architecture, normal email/password sessions, roles, and existing CSV/XLSX/PDF workflows.
- Fresh initial schema; no historical club account records or old integration migrations in the independent repository.
- Public source publication is authorized. Do not deploy this version to the club Worker.

## Risks
Authentication generalization requires validating first-owner creation and concurrent setup with real SQLite transactions. Export and import limits must be explicit rather than silently cutting off data. Performance claims need reproducible measurements.
