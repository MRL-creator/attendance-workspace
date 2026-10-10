# Contributing

Use Node.js 24+, run `npm ci`, and follow the README's local setup. Work on a branch and open a pull request with the problem, change, and verification performed.

Before proposing changes:

```sh
npm test
npm run build
npm run benchmark
npm audit
```

Add regression tests for behavior changes. Database changes need a new ordered migration after `0001_initial.sql`; do not edit an applied migration for existing installations. Keep permission checks and assignment scoping on the server, and test unauthorized as well as successful requests. Do not lower test coverage by removing assertions or skipping failing cases.

Keep dependencies focused, preserve CSV/PDF/Excel workflows, and document user-visible limits. Use synthetic fixtures. Never commit `.dev.vars`, `.wrangler`, student records, production identifiers, build/vendor output, or credentials.

## Optional browser smoke check

The repository includes `scripts/browser-smoke.py`. It needs Python, Playwright (`python -m pip install playwright`), and Microsoft Edge, or Playwright Chromium (`python -m playwright install chromium`). Start a **fresh local** database/server using the README, set `SMOKE_SETUP_KEY` to its configured setup key and `SMOKE_PASSWORD` to a test password of at least 12 characters, then:

```sh
python scripts/browser-smoke.py --url http://127.0.0.1:8787
```

Use `--channel chromium` for Playwright's bundled browser; the default channel is `msedge`. The script refuses non-loopback addresses and uses only synthetic fixtures. It creates a test owner, course, group, students and sessions, so use a disposable local database. Reruns require that same test account/password or a fresh database. Screenshots contain synthetic data and go to `docs/images`.

## Project scope

This application supports one organization per installation. Multi-tenancy, student self-service, and full spreadsheet editing require separate design and security work. Discuss such changes before expanding the scope.
