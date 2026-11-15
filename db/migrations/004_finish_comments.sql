-- Optional comments staff add when finishing a restock.
-- They appear in the managers' email and on the restock in Admin.
-- Safe to run more than once.
alter table restock_sessions add column if not exists finish_note text;
