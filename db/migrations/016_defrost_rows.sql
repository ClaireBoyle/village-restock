-- Defrost rows in a restock (Gold Class Kitchen → Defrost). Safe to run more than once.
-- Until it runs, the app still works: the extra notes and targets just aren't shown.
--
-- On a product in an area (product_placements):
-- * grab_note:     where to grab it ("Freezer 1, lower-left door, bottom shelf").
-- * fallback_note: where to look if that's empty ("Downstairs walk-in freezer").
-- * put_note:      where it goes to defrost ("Upstairs walk-in fridge").
-- * ready_unit_singular / ready_unit_plural: the unit staff count what's already ready in, when it
--   differs from the unit they pull (e.g. portions ready, 1 kg bags pulled). Blank = the same unit.
-- * ready_per:     how many ready units one pulled unit makes (e.g. 8 portions per bag). Needed for a
--   suggestion when the units differ; blank = no suggestion, staff enter the amount themselves.
-- * ready_targets: ready-stock targets by tomorrow's forecast admits, in the ready unit, e.g.
--   [{"min": 0, "max": 80, "qty": 12}, {"min": 81, "max": 160, "qty": 24}, {"min": 161, "qty": 36}]
--   (no "max" = and above). Empty = no suggestion, staff enter the amount themselves.
--
-- On a restock (restock_sessions):
-- * forecast_admits: tomorrow's forecast Gold Class admits, entered once per restock.
alter table product_placements add column if not exists grab_note text;
alter table product_placements add column if not exists fallback_note text;
alter table product_placements add column if not exists put_note text;
alter table product_placements add column if not exists ready_unit_singular text;
alter table product_placements add column if not exists ready_unit_plural text;
alter table product_placements add column if not exists ready_per numeric(10,2);
alter table product_placements add column if not exists ready_targets jsonb not null default '[]'::jsonb;
alter table restock_sessions add column if not exists forecast_admits int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_placements_defrost_notes_len') then
    alter table product_placements add constraint product_placements_defrost_notes_len check (
      length(coalesce(grab_note, '')) <= 300 and length(coalesce(fallback_note, '')) <= 300 and length(coalesce(put_note, '')) <= 300
      and (ready_unit_singular is null or length(ready_unit_singular) between 1 and 30)
      and (ready_unit_plural is null or length(ready_unit_plural) between 1 and 30));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_placements_ready_per_pos') then
    alter table product_placements add constraint product_placements_ready_per_pos check (ready_per is null or (ready_per > 0 and ready_per <= 9999));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_placements_ready_targets_array') then
    alter table product_placements add constraint product_placements_ready_targets_array check (jsonb_typeof(ready_targets) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'restock_sessions_forecast_admits_range') then
    alter table restock_sessions add constraint restock_sessions_forecast_admits_range check (forecast_admits is null or forecast_admits between 0 and 9999);
  end if;
end $$;
