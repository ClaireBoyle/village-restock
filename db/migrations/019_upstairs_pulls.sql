-- Defrost pulls (Gold Class Kitchen): how much was actually pulled from upstairs. Safe to run more than once.
-- Until it runs, the app still works: "Pulled" just can't be saved yet (it waits on the device and retries).
--
-- * session_items.upstairs_qty: pulled from the upstairs freezer for defrost (null = not pulled yet).
--   Pulled all = the amount set; "Not enough upstairs" = what was there. Whatever is still needed goes on
--   the collection list from the downstairs storeroom. An empty upstairs compartment is never a shortage
--   by itself: only collecting less than needed downstairs is.
alter table session_items add column if not exists upstairs_qty numeric(10,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_items_upstairs_qty_range') then
    alter table session_items add constraint session_items_upstairs_qty_range check (upstairs_qty is null or (upstairs_qty >= 0 and upstairs_qty <= 9999));
  end if;
end $$;
