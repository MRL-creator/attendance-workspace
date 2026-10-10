# Deploy to Cloudflare

Each installation needs its own Cloudflare account/project resources and D1 database. The repository publishes source code, not a shared hosted application. Check Cloudflare's current [Workers](https://developers.cloudflare.com/workers/platform/pricing/) and [D1](https://developers.cloudflare.com/d1/platform/pricing/) pricing and limits for your expected usage.

## 1. Prepare

Install Node.js 24+, clone the repository, and run `npm ci`, `npm test`, and `npm run build`.

```sh
npx wrangler login
npx wrangler d1 create attendance-workspace
```

PowerShell users can use `npx.cmd` / `npm.cmd` if `.ps1` execution is blocked. Do not change the system execution policy just for these commands.

## 2. Configure your database

Edit `wrangler.jsonc`:

- Set `name` to the Worker name you want in your account.
- Set `database_name` to the D1 database you created.
- Replace the zero placeholder `database_id` with the returned UUID.
- Keep the binding `DB` and `migrations_dir` unchanged.
- Optionally add `"vars": { "ALLOWED_EMAIL_DOMAINS": "example.org,example.edu" }`. Omit it or use an empty value to allow any valid email domain for new accounts.

Never copy a database ID from someone else's installation. `npm run deploy` and `npm run db:remote` reject the shipped placeholder. Local and remote D1 data are separate.

## 3. Migrate, configure setup, deploy

```sh
npm run db:remote
npm run setup:key
npx wrangler secret put BOOTSTRAP_KEY
npm run deploy
```

Paste the generated value into the secret prompt, and keep it temporarily for the setup form. Do not put secrets in `wrangler.jsonc`, GitHub issues, screenshots, or shell arguments. The key must contain at least 32 characters. `setup:key` generates 32 random bytes represented as 64 hexadecimal characters.

Open the HTTPS address printed by Wrangler. Create the workspace and its owner account, then sign in. Delete the setup secret after success:

```sh
npx wrangler secret delete BOOTSTRAP_KEY
```

The setup endpoint also rejects repeated initialization. Account creation is atomic, including when two setup requests arrive together.

## 4. Check your installation

- Sign in and create a synthetic course, group, student, and session.
- Create a test instructor and confirm that an unassigned group is inaccessible.
- Open `examples/sample-workbook.xlsx`, choose a worksheet, map its fields, and inspect the validation before importing.
- Export a report and inspect it. Remove synthetic records before using real data.
- Verify HTTPS, configure any desired custom domain, and save an independent database export.

## Updating and recovery

Back up your D1 database before schema changes. Review new migration files, test them against a local copy containing synthetic data, then run `npm run db:remote` before `npm run deploy`. Do not reapply this edition's fresh `0001_initial.sql` to an existing installation of another edition.

Use Cloudflare's database export/restore tools for disaster recovery. In-app deletion snapshots cover supported operations only and do not replace full database backups. Establish your own retention schedule. Worker version rollback does not reverse database migrations.

If the only owner loses their password, there is no email reset service. An operator must recover access through a trusted database/backup procedure; do not delete the workspace singleton or rerun setup against a populated database.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Workspace unavailable | D1 binding is `DB`; the correct database was migrated; inspect Worker logs |
| Setup key rejected | Secret exists in this Worker, matches exactly, and is at least 32 characters |
| Setup already completed | Sign in; another initialization may have won the first-run race |
| Email rejected | Address format and optional `ALLOWED_EMAIL_DOMAINS` allowlist |
| Wrong database appears locally | Local D1 state belongs to this repository and its configured database ID |
| Cloudflare settings disappear | Keep non-secret configuration in Wrangler; `keep_vars` preserves dashboard variables, but source-controlled settings are easier to reproduce |

Official references: [D1 getting started](https://developers.cloudflare.com/d1/get-started/), [local development](https://developers.cloudflare.com/d1/best-practices/local-development/), [migrations](https://developers.cloudflare.com/d1/reference/migrations/), and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
