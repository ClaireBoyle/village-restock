-- Village Restock: Phase 3
-- Run once in the Supabase SQL editor, after 001.
--
-- When two devices enter different counts for the same product, the server
-- keeps the first and records the clash here, so staff can choose which is
-- right. Nothing is silently overwritten.

alter table session_items add column if not exists conflict jsonb;
alter table session_items add column if not exists updated_device text;

-- Supervisors resolve shortages with a short note.
create index if not exists restock_sessions_day_idx on restock_sessions (trading_date desc, department_id);
