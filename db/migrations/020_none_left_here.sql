-- "None left here" (Gold Class Bar): when staff add an item to collect on the Bar or Upstairs checks,
-- they can tick that the spot is empty (an open bottle that can still be used counts as stock).
-- At Finish each shortfall is then Out of stock, Low stock · Still available, or Top-up incomplete.
-- Safe to run more than once. Until it runs, the app still works: the tick and Finish corrections
-- just wait on the device and retry.
--
-- * departments.none_left_check: the department uses this rule (Gold Class Bar).
-- * session_items.none_left_here: staff ticked "None left here" for this spot.
-- * session_items.status_override: a status staff chose on the Finish screen (out · low · unconfirmed).
-- * shortages.stock_status: the status the shortage finished with (for the Shortages page).
alter table departments add column if not exists none_left_check boolean not null default false;
alter table session_items add column if not exists none_left_here boolean not null default false;
alter table session_items add column if not exists status_override text;
alter table shortages add column if not exists stock_status text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'session_items_status_override_check') then
    alter table session_items add constraint session_items_status_override_check check (status_override is null or status_override in ('out', 'low', 'unconfirmed'));
  end if;
end $$;
update departments set none_left_check = true where lower(name) = 'gold class bar' and not none_left_check;
