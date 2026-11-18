-- "Completed by": the name staff confirm on the Finish screen, kept on the finished restock.
-- Safe to run more than once. Until it runs, the app still works (the name just isn't stored).
alter table restock_sessions add column if not exists completed_by text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'restock_sessions_completed_by_len') then
    alter table restock_sessions add constraint restock_sessions_completed_by_len check (completed_by is null or length(completed_by) between 1 and 40);
  end if;
end $$;
