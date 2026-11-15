-- Village Restock: menu links and manager email
-- Run once in the Supabase SQL editor, after 002. Safe to run more than once.

-- Menu items to mark as sold out when a product runs out,
-- e.g. Coleslaw -> {"Golden Harvest Burger"}.
alter table products add column if not exists affects text[] not null default '{}';

-- One email per finished full restock. Queued in the same transaction that
-- finishes the restock, then sent by the server (and retried if sending fails),
-- so an email is never lost and never sent twice.
create table if not exists email_outbox (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references restock_sessions(id) on delete cascade,
  finished_at timestamptz not null,
  recipient   text not null,
  subject     text not null,
  html        text not null,
  body_text   text not null,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts    int not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (session_id, finished_at)
);
create index if not exists email_outbox_pending on email_outbox (status, created_at);

alter table email_outbox enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on table email_outbox from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on table email_outbox from authenticated; end if;
end $$;

-- Manager email settings (set in Admin > Access & settings). Off until an address is entered.
insert into app_settings (key, value) values ('manager_email', '""'::jsonb), ('manager_email_enabled', 'false'::jsonb)
on conflict (key) do nothing;
