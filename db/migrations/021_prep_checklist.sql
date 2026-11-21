-- Prep checklist (Gold Class Kitchen): staff open it any time, e.g. before a busy night, to check what's ready
-- and what still needs prepping for that service. Safe to run more than once. Until it runs, the app still works:
-- the Prep checklist just says it needs this update.
--
-- * prep_tasks.checklist_group / checklist_name: how a task is shown on the checklist, grouped so staff can check
--   one shelf at a time (e.g. "Make sauces" · "Burger sauce"). Blank = its group and task name.
-- * prep_tasks.on_checklist: shown on the Prep checklist (the morning handover uses prep_tasks.active, as before).
--   The same task list (Admin → Morning prep) feeds both: add or reorder a job once.
-- * prep_checks: one row per department, service (trading day) and task. status: null = Unchecked,
--   'ready' = enough prepped, 'needs' = needs prep for this service. morning = "Leave for morning" (on the
--   opener's handover; morning_done_* when the morning team marks it Done). Each service starts fresh.
alter table prep_tasks add column if not exists checklist_group text;
alter table prep_tasks add column if not exists checklist_name text;
alter table prep_tasks add column if not exists on_checklist boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'prep_tasks_checklist_text') then
    alter table prep_tasks add constraint prep_tasks_checklist_text check ((checklist_group is null or length(checklist_group) <= 60) and (checklist_name is null or length(checklist_name) <= 80));
  end if;
end $$;

create table if not exists prep_checks (
  department_id   uuid not null references departments(id) on delete cascade,
  trading_date    date not null,
  task_id         uuid not null references prep_tasks(id) on delete cascade,
  task_name       text not null,
  status          text check (status is null or status in ('ready', 'needs')),
  morning         boolean not null default false,
  note            text check (note is null or length(note) <= 200),
  morning_done_at timestamptz,
  morning_done_by text,
  updated_by      text,
  updated_at      timestamptz not null default now(),
  primary key (department_id, trading_date, task_id)
);
create index if not exists prep_checks_day on prep_checks (department_id, trading_date desc);
