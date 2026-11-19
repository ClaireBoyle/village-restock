-- Morning prep handover (Gold Class Kitchen). Safe to run more than once.
-- Until it runs, restocks still work: the "Morning prep needed" section just isn't shown.
--
-- * prep_tasks: the checklist staff choose from (Vegetables, Proteins, Sauces), per department.
--   Add more in Admin → Morning prep, no code change needed.
-- * prep_handovers / prep_handover_items: what the closing team said the morning team needs to
--   prep, kept with that night's restock but tracked separately: the morning team marks each
--   task Done; that never changes the restock, and the restock finishing never changes the prep.
--   status: 'needed' (tasks chosen) or 'none' ("No morning prep needed").
-- * product_placements.prep_task_id: stock made or portioned in morning prep (e.g. cut carrot,
--   vodka sauce). Entered amounts are shown for the morning team, not put on the downstairs list.
create table if not exists prep_tasks (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete cascade,
  grp           text not null default 'other' check (grp in ('vegetables', 'proteins', 'sauces', 'other')),
  name          text not null check (length(trim(name)) between 1 and 80),
  sort_order    int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists prep_tasks_name_key on prep_tasks (department_id, lower(name));

create table if not exists prep_handovers (
  session_id    uuid primary key references restock_sessions(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  trading_date  date not null,
  status        text not null check (status in ('needed', 'none')),
  updated_by    text,
  updated_at    timestamptz not null default now()
);
create index if not exists prep_handovers_dept on prep_handovers (department_id, trading_date desc);

create table if not exists prep_handover_items (
  id         uuid primary key,
  session_id uuid not null references prep_handovers(session_id) on delete cascade,
  task_id    uuid references prep_tasks(id) on delete set null,
  grp        text not null default 'other' check (grp in ('vegetables', 'proteins', 'sauces', 'other')),
  name       text not null check (length(trim(name)) between 1 and 80),
  qty        text check (qty is null or length(qty) <= 30),
  note       text check (note is null or length(note) <= 200),
  sort_order int  not null default 0,
  done_at    timestamptz,
  done_by    text,
  updated_at timestamptz not null default now()
);
create index if not exists prep_handover_items_session on prep_handover_items (session_id);

alter table product_placements add column if not exists prep_task_id uuid references prep_tasks(id) on delete set null;

-- The checklist is part of the catalogue devices download.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'prep_tasks_catalogue') then
    create trigger prep_tasks_catalogue after insert or update or delete on prep_tasks for each statement execute function bump_catalogue_version();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'prep_tasks_updated') then
    create trigger prep_tasks_updated before update on prep_tasks for each row execute function set_updated_at();
  end if;
end $$;
