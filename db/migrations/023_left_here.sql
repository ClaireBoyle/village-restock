-- Gold Class Bar: "Some left" / "None left" at the shelf. Safe to run more than once.
-- Until it runs, the app still works: "None left" is saved as before (none_left_here) and "Some left" isn't
-- recorded yet, so a short top-up there reads "Top-up incomplete" as before.
--
-- * session_items.left_here: what staff said is left at that spot when they entered a top-up there:
--   'some' (an open bottle or jar with usable stock counts) or 'none'. Blank = not said (e.g. a suggested amount,
--   a skipped area, or a restock from before this update).
alter table session_items add column if not exists left_here text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_items_left_here_check') then
    alter table session_items add constraint session_items_left_here_check check (left_here is null or left_here in ('some', 'none'));
  end if;
end $$;
