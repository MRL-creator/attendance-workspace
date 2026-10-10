# Security

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** for this repository if enabled. Otherwise open an issue requesting a private reporting channel without including exploit details. Never post passwords, setup keys, session tokens, database dumps, or personal/student data in public reports.

## Existing controls

- Backend capabilities and instructor/session scope checks, independent of hidden UI buttons.
- Parameterized SQL and validation of IDs, values, dates, roles, and import decisions.
- Salted PBKDF2-SHA-256 password hashes (100,000 iterations), random hashed session tokens, 8-hour Secure/HttpOnly/SameSite=Lax cookies, and origin checks on mutations.
- Login throttling by connecting IP (8 failed attempts within 15 minutes).
- One-time setup protected by a random secret, transactional singleton initialization, and role-based owner protection.
- Escaped rendered values, CSP, frame restrictions, and formula-prefix protection in CSV/XLSX exports.
- Size/range bounds for supported file imports; imported workbooks are not evaluated.

## Operator responsibilities and limitations

Use HTTPS, unique strong passwords, least-privilege staff roles, independent database backups, and an appropriate data-retention policy. Review Cloudflare access, logs, dependency updates, and the legal requirements applicable to your organization. This repository does not supply a universal privacy policy or terms of service: operators must publish policies matching their own deployment.

There is no MFA, email verification, account recovery email, tenant isolation, independent security audit, or guarantee of compliance. Names may be personal data; collect and share only what your organization needs. Read-only viewers can see the whole workspace, and downloaded reports leave application access controls.

Localhost development may rely on browser treatment of secure cookies on loopback. Do not relax production cookie security to support an insecure hosted deployment. New-account domain allowlists do not verify mailbox ownership and do not block existing accounts from signing in.

The dependency audit reports known registry advisories, not proof that all dependencies or arbitrary imported files are safe. Keep `package-lock.json` current and review upstream SheetJS/PDF.js updates as well as npm advisories.
