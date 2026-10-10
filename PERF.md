# Performance review

## Group history: remove per-session request fan-out

Measured on 2026-10-10 with Node.js 24 and the real schema in an in-memory SQLite database, using a synthetic instructor, assigned group, 100 sessions and 101 marks (including a deleted student's saved name).

| Roster-loading strategy | API requests | SQL queries including auth/access checks | Observed local elapsed time |
| --- | ---: | ---: | ---: |
| Individual session attendance endpoints | 100 | 400 | 42.33 ms |
| Scoped bulk group-history endpoint | 1 | 4 | 2.77 ms |

The group page still fetches its group list, students, and session metadata. Its total request count therefore changes from `3 + session count` to **4**, rather than all page work becoming one request. The client builds a Map by session once, avoiding repeated filtering.

Reproduce with `npm run benchmark`. Timings vary by host and do not include Cloudflare/network latency. Request/query counts are the useful structural result: 99% fewer roster requests and queries for this fixture. This is not a production latency or capacity benchmark. Tests compare returned records against individual authorized rosters, check assignment/capability restrictions, archived sessions, deleted-student names, the latest-500 selection, and oversized-output errors.

## Bounded file and report processing

- SheetJS remains dynamically loaded, so users who never open/export Excel do not need the Excel parser in the initial app chunk.
- Browser preview is capped at 2,000 rows and 50 columns. Import checks the worksheet's original full range before mapping; oversized imports fail rather than silently losing later rows.
- Changing the workbook, worksheet, mapping, or target invalidates earlier validation. Corrupt files cannot reuse stale import decisions.
- Group history rejects more than 50,000 marks and tells the user to use date-filtered Reports.
- Export checks one row beyond the 20,000-mark boundary and refuses oversized exports rather than silently producing an incomplete report. Stable attendance-ID ordering makes pagination deterministic.

## Dependency review

The original local toolchain's dependency audit identified a high-severity issue through the image dependency used by Wrangler/Miniflare. Updating Wrangler to 4.149.0 resolved the known advisory chain. `npm audit` reported **0 vulnerabilities** during the release review. Audit results change as new advisories are published; they do not prove that dependencies have no undiscovered issues.

## Remaining opportunities

- Profile D1 scans with a realistic, anonymized dataset before changing indexes or export pagination. OFFSET export queries can repeat sorting work as reports grow; keyset pagination is a possible future improvement.
- Consider server pagination for currently bounded staff/student/group/session lists when targeting large institutions. Do not present bounded lists as complete historical analytics.
- A virtualized workbook grid could improve scrolling for wide/heavily formatted sheets, but needs a measured browser bottleneck before adding complexity.
- Login attempts, expired sessions, audit logs, and deletion backups need operator-defined cleanup/retention. Scheduled deletion should be designed with retention requirements rather than silently discarding history.
- Password hashing and owner recovery deserve a dedicated security design if this evolves into a large hosted product; that is separate from the request/query optimization here.
