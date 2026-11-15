-- Reference photos for products and checking areas.
-- Photos are shrunk on the device before upload (about 100-250 KB each) and
-- stored here, so no separate file storage needs setting up.
-- Safe to run more than once.
create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  data         bytea not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes        int  not null check (bytes > 0 and bytes <= 2000000),
  created_at   timestamptz not null default now()
);
alter table photos enable row level security;
-- Only the app's server reads photos (Supabase's public API roles get nothing).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table photos from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table photos from authenticated; end if;
end $$;
