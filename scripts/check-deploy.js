import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const database = config.d1_databases?.find(item => item.binding === 'DB');
if (!database || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(database.database_id) || database.database_id === '00000000-0000-0000-0000-000000000000') {
  console.error('Configure your own D1 database ID in wrangler.jsonc before deploying or migrating remotely. See docs/deployment.md.');
  process.exitCode = 1;
}
