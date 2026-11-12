-- Village Restock: initial schema
-- Run once in the Supabase SQL editor (or with `npm run db:migrate` against a local database).
--
-- Two kinds of data:
--   1. Permanent configuration, edited by admins: departments, areas, storage
--      locations, categories, products, par levels.
--   2. Restock sessions: temporary observations staff record during a restock.
--      Session rows copy (snapshot) product names and par levels, so editing
--      the catalogue never rewrites a past restock.
--
-- Security: the browser never talks to this database directly. Every table has
-- row level security switched ON with no policies, and the public Supabase
-- roles have their privileges revoked. Only the app's server code, using the
-- private connection string, can read or write.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value) values
  ('catalogue_version', '1'::jsonb),
  ('staff_code_version', '1'::jsonb),
  ('trading_day_cutoff_hour', '5'::jsonb),
  ('timezone', '"Australia/Melbourne"'::jsonb);

-- Every change to configuration bumps catalogue_version so devices know to
-- download a fresh copy of the catalogue.
create or replace function bump_catalogue_version() returns trigger
language plpgsql as $$
begin
  update app_settings
     set value = to_jsonb((value::text)::bigint + 1), updated_at = now()
   where key = 'catalogue_version';
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Permanent configuration
-- ---------------------------------------------------------------------------
create table departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  short_name  text not null check (length(trim(short_name)) between 1 and 30),
  group_label text not null default '' check (length(group_label) <= 30),
  theme       text not null default 'village' check (theme in ('village', 'gold')),
  icon        text not null default 'box' check (icon in ('bar', 'kitchen', 'candy', 'box')),
  description text not null default '' check (length(description) <= 160),
  sort_order  int  not null default 0,
  active      boolean not null default true,
  is_sample   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index departments_name_key on departments (lower(name));

create table check_areas (
  id               uuid primary key default gen_random_uuid(),
  department_id    uuid not null references departments(id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 60),
  guide_text       text not null default '' check (length(guide_text) <= 600),
  guide_photo_path text,
  sort_order       int  not null default 0,
  active           boolean not null default true,
  is_sample        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index check_areas_name_key on check_areas (department_id, lower(name));

create table storage_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 60),
  sort_order int  not null default 0,
  active     boolean not null default true,
  is_sample  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index storage_locations_name_key on storage_locations (lower(name));

create table categories (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 40),
  sort_order    int  not null default 0,
  active        boolean not null default true,
  is_sample     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index categories_name_key on categories (department_id, lower(name));

create table products (
  id                  uuid primary key default gen_random_uuid(),
  department_id       uuid not null references departments(id) on delete cascade,
  category_id         uuid references categories(id) on delete set null,
  name                text not null check (length(trim(name)) between 1 and 80),
  unit_singular       text not null check (length(trim(unit_singular)) between 1 and 30),
  unit_plural         text not null check (length(trim(unit_plural)) between 1 and 30),
  method              text not null check (method in ('par', 'manual', 'routine')),
  allow_decimal       boolean not null default false,
  instructions        text not null default '' check (length(instructions) <= 400),
  default_location_id uuid references storage_locations(id) on delete set null,
  photo_path          text,
  status              text not null default 'active' check (status in ('active', 'archived')),
  sort_order          int  not null default 0,
  is_sample           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index products_department_idx on products (department_id, status, sort_order);

-- Where a product is checked. One product can live in several areas, each
-- with its own par level (e.g. beer in the bar fridge AND on the back shelf).
create table product_placements (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  check_area_id uuid not null references check_areas(id) on delete cascade,
  par_level     numeric(10,2) check (par_level is null or (par_level >= 0 and par_level <= 9999)),
  location_id   uuid references storage_locations(id) on delete set null, -- overrides product default
  instructions  text check (instructions is null or length(instructions) <= 400),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, check_area_id)
);
create index product_placements_area_idx on product_placements (check_area_id, sort_order);

create trigger departments_updated before update on departments for each row execute function set_updated_at();
create trigger check_areas_updated before update on check_areas for each row execute function set_updated_at();
create trigger storage_locations_updated before update on storage_locations for each row execute function set_updated_at();
create trigger categories_updated before update on categories for each row execute function set_updated_at();
create trigger products_updated before update on products for each row execute function set_updated_at();
create trigger product_placements_updated before update on product_placements for each row execute function set_updated_at();

create trigger departments_catalogue after insert or update or delete on departments for each statement execute function bump_catalogue_version();
create trigger check_areas_catalogue after insert or update or delete on check_areas for each statement execute function bump_catalogue_version();
create trigger storage_locations_catalogue after insert or update or delete on storage_locations for each statement execute function bump_catalogue_version();
create trigger categories_catalogue after insert or update or delete on categories for each statement execute function bump_catalogue_version();
create trigger products_catalogue after insert or update or delete on products for each statement execute function bump_catalogue_version();
create trigger product_placements_catalogue after insert or update or delete on product_placements for each statement execute function bump_catalogue_version();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- Supervisors and managers. Staff do not have accounts; they use a shared
-- access code (stored hashed in app_settings under 'staff_code_hash').
create table admins (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  display_name  text not null check (length(trim(display_name)) between 1 and 40),
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index admins_email_key on admins (lower(email));

-- Used to slow down repeated wrong codes/passwords. Only failures are stored,
-- and only a one-way hash of the IP address, not the address itself.
create table login_failures (
  id        bigserial primary key,
  kind      text not null check (kind in ('staff', 'admin')),
  ip_hash   text not null,
  failed_at timestamptz not null default now()
);
create index login_failures_lookup on login_failures (kind, ip_hash, failed_at);

-- ---------------------------------------------------------------------------
-- Restock sessions (used from Phase 2)
-- ---------------------------------------------------------------------------
create table restock_sessions (
  id               uuid primary key,              -- generated on the device, so it works offline
  department_id    uuid not null references departments(id) on delete cascade,
  kind             text not null check (kind in ('full', 'quick')),
  trading_date     date not null,
  status           text not null default 'open'
                   check (status in ('open', 'finished', 'finished_exceptions', 'unfinished')),
  exception_reason text,
  people           text[] not null default '{}',  -- first names / initials only
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  version          int not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- At most one full restock per department per trading day.
create unique index restock_sessions_one_full on restock_sessions (department_id, trading_date) where kind = 'full';
create trigger restock_sessions_updated before update on restock_sessions for each row execute function set_updated_at();

create table session_areas (
  session_id    uuid not null references restock_sessions(id) on delete cascade,
  check_area_id uuid not null,
  area_name     text not null,
  status        text not null default 'not_started'
                check (status in ('not_started', 'in_progress', 'complete', 'skipped')),
  skip_reason   text,
  updated_by    text,
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  primary key (session_id, check_area_id),
  check (status <> 'skipped' or length(trim(coalesce(skip_reason, ''))) > 0)
);

create table session_items (
  session_id       uuid not null references restock_sessions(id) on delete cascade,
  placement_id     uuid not null,
  product_id       uuid not null,
  check_area_id    uuid not null,
  -- snapshot of configuration at the time the item was first touched
  product_name     text not null,
  unit_singular    text not null,
  unit_plural      text not null,
  method           text not null check (method in ('par', 'manual', 'routine')),
  par_level        numeric(10,2),
  location_name    text,
  -- observations
  current_qty      numeric(10,2) check (current_qty is null or current_qty >= 0),
  requested_qty    numeric(10,2) check (requested_qty is null or requested_qty >= 0),
  routine_choice   text check (routine_choice is null or routine_choice in ('needed', 'not_needed')),
  collected_mode   text check (collected_mode is null or collected_mode in ('all', 'partial')),
  collected_qty    numeric(10,2) check (collected_qty is null or collected_qty >= 0),
  shortfall_reason text check (shortfall_reason is null or shortfall_reason in ('insufficient', 'access', 'time', 'other')),
  flagged          boolean not null default false,
  updated_by       text,
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  primary key (session_id, placement_id)
);

create table shortages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references restock_sessions(id) on delete set null,
  department_id   uuid not null references departments(id) on delete cascade,
  product_id      uuid,
  product_name    text not null,
  unit_plural     text not null,
  shortfall_qty   numeric(10,2) not null check (shortfall_qty > 0),
  reason          text not null check (reason in ('insufficient', 'access', 'time', 'other')),
  flagged         boolean not null default false,
  note            text,
  reported_by     text,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
);
create index shortages_open_idx on shortages (status, created_at desc);

-- Offline sync: every change a device sends carries a unique id. Recording it
-- here means a change that is sent twice (e.g. after a dropped connection) is
-- only ever applied once.
create table sync_ops (
  op_id       uuid primary key,
  device_id   text not null,
  received_at timestamptz not null default now(),
  result      jsonb not null
);

-- ---------------------------------------------------------------------------
-- Lock everything down from the public Supabase API roles
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'app_settings','departments','check_areas','storage_locations','categories','products',
    'product_placements','admins','login_failures','restock_sessions','session_areas',
    'session_items','shortages','sync_ops'
  ] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
