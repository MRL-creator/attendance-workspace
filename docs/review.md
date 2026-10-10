# Edition review — 2026-10-10

## Scope

Created a separate source repository and fresh D1 schema for general self-hosting. No original Git history, production binding, local secrets, real users, student records, or club logo were copied into this edition. The original repository remained at its starting commit with a clean working tree. No production Worker deployment or remote database operation was performed.

## Checks completed

| Check | Result |
| --- | --- |
| Existing baseline tests | 33 passed before application changes |
| Final automated tests | 45 passed; no skipped tests |
| Syntax checks and production build | Passed |
| Fresh local D1 migration through Wrangler | Passed |
| Dependency audit | Zero known vulnerabilities after toolchain update |
| First clean GitHub Linux CI run | [Passed](https://github.com/MRL-creator/attendance-workspace/actions/runs/38050792964) |
| Documentation links | Local targets verified |
| Source scan | No old email restriction, production database ID, obsolete integration identifiers, local user paths, or credential patterns |
| Staged files and diff review | Generated assets, local database, browser test tooling, and environment secrets excluded |

## Behavior and access review

- First-run setup accepts a chosen ordinary email/password, creates one owner who can also teach, and saves the chosen workspace name.
- Missing/short/wrong setup keys, invalid input, disallowed domains, cross-origin requests, and repeated setup are rejected. Concurrent requests create one owner; database failures roll back the complete setup batch.
- Owner protection uses stored roles rather than a designated person's email. Account creation cannot elevate another account to owner.
- Bulk history matches individual authorized rosters, retains deleted-student names, excludes archived sessions, enforces assignment/capability checks, and matches latest-500 session ordering.
- Oversized histories and report exports produce errors instead of incomplete totals/files.
- Excel import checks the original worksheet range and clears stale validation after changes or corrupt files.

## Browser checks

Ran the local Worker in headless Microsoft Edge with synthetic fixtures. Verified setup, login, workbook tabs and search, explicit manual mapping and missing-map error, student XLSX import, attendance XLSX import, CSV duplicate review, corrupt-file handling, group history, XLSX/CSV export, workspace naming, saved themes, and 390px mobile navigation/settings without horizontal page overflow or browser exceptions. Reopened the exported XLSX with SheetJS and checked the Attendance, Students, and Session Summary sheets.

Screenshots in `docs/images` contain only synthetic data. The reusable smoke script is in `scripts/browser-smoke.py`; see CONTRIBUTING.md for prerequisites and its local-only guard.

## Practical limits

This review is not an independent penetration test or a production load test. The application remains one organization per installation, with bounded lists/imports/exports and no MFA, email verification/reset delivery, or tenant isolation. Name-based attendance imports cannot disambiguate identical student names in the same roster. See [the user guide](user-guide.md#limits-and-non-goals), [security notes](../SECURITY.md), and [performance review](../PERF.md) before operating it with real data.
