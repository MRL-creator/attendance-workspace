# Attendance Workspace: from club workflow to reusable application

## Problem

Classes and workshops need a consistent way to organize groups, record sessions,
and review attendance. The original club application had organization-specific
assumptions; this independent edition makes setup and ownership configurable.

## Work delivered

The application combines a browser interface, Cloudflare Worker API, and D1
database. It supports staff roles, course/group assignments, attendance history,
a workbook viewer, import previews with manual mapping and duplicate review,
and CSV/XLSX/PDF reporting. Each installation starts with its own empty database
and owner account. Screenshots and examples use synthetic people.

## A difficult decision

Group history originally loaded each session roster separately. Replacing that
fan-out with one bulk endpoint reduced requests, but the endpoint still had to
enforce assignments and capabilities, preserve deleted students' saved names,
and select the same sessions. Regression tests compare the bulk response with
individual authorized rosters rather than checking query text.

## Evidence

The [reproducible benchmark](../PERF.md) uses the real SQLite schema with
100 synthetic sessions: roster loading changes from **100 requests and
400 SQL queries to 1 request and 4 queries**. The full page still makes four
requests because group, student, and session metadata also load.

Run `npm run benchmark`. These counts describe this fixture; local timings do
not measure Cloudflare latency or real-world time saved. The repository also
contains [release verification](review.md), [architecture](architecture.md),
and [security notes](../SECURITY.md).

## Engineering lesson and next step

An optimization is useful only if it preserves access rules and historical
meaning. The next evidence to collect is consented operational feedback and
a realistic, anonymized workload. No adoption numbers or user time savings
have been measured for this independent edition.

