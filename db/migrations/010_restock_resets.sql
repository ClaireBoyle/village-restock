-- Admin "Reset restock" and "Clear test activity".
-- A reset deletes a restock (its entries, areas, shortages and email) and leaves a small
-- record here, so devices that still hold an old copy or queued changes for it are told
-- "this was reset" and drop them, instead of quietly recreating it.
-- Products, photos, areas, storerooms, targets and settings are never touched.
-- Safe to run more than once.
create table if not exists restock_resets (
  session_id    uuid primary key,
  department_id uuid not null,
  kind          text not null,
  trading_date  date not null,
  area_id       uuid,
  reset_at      timestamptz not null default now(),
  reset_by      text
);
create index if not exists restock_resets_scope on restock_resets (department_id, trading_date, kind);
create index if not exists restock_resets_at on restock_resets (reset_at);

-- Defrost Planner records cleared as test activity (one department and service date each).
create table if not exists defrost_resets (
  department_id uuid not null,
  service_date  date not null,
  reset_at      timestamptz not null default now(),
  reset_by      text,
  primary key (department_id, service_date)
);

alter table restock_resets enable row level security;
alter table defrost_resets enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table restock_resets, defrost_resets from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table restock_resets, defrost_resets from authenticated; end if;
end $$;
