import postgres from 'postgres';

// One shared connection pool per server instance.
// - prepare: false is required for Supabase's transaction pooler (port 6543),
//   which is what Vercel's short-lived functions should connect through.
// - numeric columns come back as JS numbers instead of strings.
// - snake_case columns are converted to camelCase properties.
type Sql = postgres.Sql<Record<string, unknown>>;

const g = globalThis as unknown as { __vrSql?: Sql };

export function db(): Sql {
  if (g.__vrSql) return g.__vrSql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. See README.md > Environment variables.');
  g.__vrSql = postgres(url, {
    prepare: false,
    max: process.env.NODE_ENV === 'production' ? 3 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: postgres.camel,
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
    onnotice: () => {},
  }) as unknown as Sql;
  return g.__vrSql;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db()`select value from app_settings where key = ${key}`;
  return rows.length ? (rows[0].value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db()`
    insert into app_settings (key, value) values (${key}, ${db().json(value as postgres.JSONValue)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
