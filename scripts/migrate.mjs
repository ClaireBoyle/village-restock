// Applies db/migrations/*.sql in order to DATABASE_URL, recording which ones
// have run. Optional: `--seed` also loads db/seed/sample_data.sql.
// For Supabase you can instead paste the files into the SQL editor.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const dir = join(process.cwd(), 'db', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    console.log(`Applying ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
      await tx`insert into schema_migrations (name) values (${file})`;
    });
  }
  if (process.argv.includes('--seed')) {
    console.log('Loading sample data');
    await sql.unsafe(readFileSync(join(process.cwd(), 'db', 'seed', 'sample_data.sql'), 'utf8'));
  }
  console.log('Database is up to date.');
} finally {
  await sql.end();
}
