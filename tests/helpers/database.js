import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Execute the real schema and SQL; expose the small D1 surface used by the Worker.
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const db = {
    sqlite, queries: 0,
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) { this.values = values; return this; },
        execute(kind) { db.queries++; return sqlite.prepare(sql)[kind](...this.values); },
        async first() { return this.execute('get') || null; },
        async all() { return { results: this.execute('all') }; },
        async run() { return { success: true, meta: this.execute('run') }; }
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => ({ success: true, meta: statement.execute('run') }));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return db;
}
