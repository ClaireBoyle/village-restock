-- Defrost Planner (Gold Class Kitchen): what frozen stock to defrost for the next service.
-- Separate from restocking and from the morning opener's prep. Safe to run more than once.

-- What can be defrosted, set up by managers. Food-safety values come from the kitchen's
-- approved procedures; the app never changes them by itself.
create table if not exists defrost_items (
  id                 uuid primary key default gen_random_uuid(),
  department_id      uuid not null references departments(id) on delete cascade,
  name               text not null check (length(trim(name)) between 1 and 80),
  unit_singular      text not null default 'portion' check (length(trim(unit_singular)) between 1 and 30),
  unit_plural        text not null default 'portions' check (length(trim(unit_plural)) between 1 and 30),
  expected_demand    numeric(10,2) not null default 0 check (expected_demand >= 0 and expected_demand <= 9999),
  -- Optional per-weekday expected demand, e.g. {"sat": 30, "mon": 12} (keys mon..sun)
  weekday_demand     jsonb not null default '{}'::jsonb,
  buffer             numeric(10,2) not null default 0 check (buffer >= 0 and buffer <= 9999),
  pack_size          numeric(10,2) not null default 1 check (pack_size > 0 and pack_size <= 9999),
  min_qty            numeric(10,2) not null default 0 check (min_qty >= 0 and min_qty <= 9999),
  thaw_method        text not null default '' check (length(thaw_method) <= 120),
  thaw_hours         numeric(6,2) check (thaw_hours is null or (thaw_hours >= 0 and thaw_hours <= 240)),
  shelf_life_hours   numeric(7,2) check (shelf_life_hours is null or (shelf_life_hours > 0 and shelf_life_hours <= 2400)),
  safety_notes       text not null default '' check (length(safety_notes) <= 400),
  sort_order         int  not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists defrost_items_dept on defrost_items (department_id, active, sort_order);

-- One plan per department per service date.
create table if not exists defrost_plans (
  id            uuid primary key,
  department_id uuid not null references departments(id) on delete cascade,
  service_date  date not null,
  people        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (department_id, service_date)
);

-- What staff entered for each item. Blank (null) means "not entered", never 0.
create table if not exists defrost_entries (
  plan_id        uuid not null references defrost_plans(id) on delete cascade,
  item_id        uuid not null references defrost_items(id) on delete cascade,
  item_name      text not null,
  chilled_qty    numeric(10,2) check (chilled_qty is null or chilled_qty >= 0),
  thawing_qty    numeric(10,2) check (thawing_qty is null or thawing_qty >= 0),
  adjust_qty     numeric(10,2) check (adjust_qty is null or (adjust_qty >= -9999 and adjust_qty <= 9999)),
  suggested_qty  numeric(10,2),
  defrost_qty    numeric(10,2) check (defrost_qty is null or defrost_qty >= 0),
  -- Optional, about the service just finished
  ran_out        boolean not null default false,
  discarded_qty  numeric(10,2) check (discarded_qty is null or discarded_qty >= 0),
  discard_reason text check (discard_reason is null or length(discard_reason) <= 80),
  updated_by     text,
  updated_at     timestamptz not null default now(),
  primary key (plan_id, item_id)
);

insert into app_settings (key, value) values ('defrost_service_time', '"11:00"') on conflict (key) do nothing;
-- Stock Insights thresholds (editable in Admin > Stock Insights)
insert into app_settings (key, value) values
  ('insights_window_days', '7'), ('insights_shortage_days', '3'), ('insights_turnover_days', '5'),
  ('insights_defrost_days', '3'), ('insights_waste_days', '2')
on conflict (key) do nothing;

-- Devices pick up defrost item changes like any catalogue change.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'defrost_items_catalogue') then
    create trigger defrost_items_catalogue after insert or update or delete on defrost_items for each statement execute function bump_catalogue_version();
  end if;
end $$;

-- Only the app's server reads and writes these (Supabase's public API roles get nothing).
alter table defrost_items enable row level security;
alter table defrost_plans enable row level security;
alter table defrost_entries enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table defrost_items, defrost_plans, defrost_entries from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table defrost_items, defrost_plans, defrost_entries from authenticated;
  end if;
end $$;
