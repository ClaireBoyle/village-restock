-- Collection list: what to take downstairs, and where to reach in the storeroom. Safe to run more than once.
-- Until it runs, the app still works (no reminders, no storeroom spots).
--
-- * products.collect_reminder: shown at the top of the collection list, above the first storeroom, whenever
--   this product is on it (e.g. "Take tubs and boxes for the burger patties"). Include the number of
--   containers only once it's confirmed. Blank = no reminder.
-- * product_placements.collect_note: where to find it in the storeroom, shown on its collection line
--   (e.g. "Lower-right compartment, beside the zucchini wedges"). Blank = nothing extra.
alter table products add column if not exists collect_reminder text;
alter table product_placements add column if not exists collect_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_collect_reminder_len') then
    alter table products add constraint products_collect_reminder_len check (collect_reminder is null or length(collect_reminder) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_placements_collect_note_len') then
    alter table product_placements add constraint product_placements_collect_note_len check (collect_note is null or length(collect_note) <= 120);
  end if;
end $$;
