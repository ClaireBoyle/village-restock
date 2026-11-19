-- Refill tasks and linked rows (Gold Class Kitchen). Safe to run more than once.
-- Until it runs, the app still works: refill rows and linked rows just show as ordinary products.
--
-- * product_placements.refill_source: this row is a working drawer or tub refilled from stock already
--   upstairs (e.g. "Tender box in Freezer 2, lower left"). Staff answer Refilled / Already full /
--   Needs stock. That records the task only: no amount, never on the collection list.
-- * product_placements.linked_placement_id: this row shows, and edits, another row's requirement
--   (e.g. a dessert on the walk-in's dessert shelf shows what's already planned in Defrost), so the
--   same requirement is never entered twice.
-- * session_items.refill_status: refilled · full (already full) · needs_stock (refill still to do).
alter table product_placements add column if not exists refill_source text;
alter table product_placements add column if not exists linked_placement_id uuid references product_placements(id) on delete set null;
alter table session_items add column if not exists refill_status text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_placements_refill_source_len') then
    alter table product_placements add constraint product_placements_refill_source_len check (refill_source is null or length(refill_source) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_placements_linked_not_self') then
    alter table product_placements add constraint product_placements_linked_not_self check (linked_placement_id is null or linked_placement_id <> id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'session_items_refill_status_check') then
    alter table session_items add constraint session_items_refill_status_check check (refill_status is null or refill_status in ('refilled', 'full', 'needs_stock'));
  end if;
end $$;
