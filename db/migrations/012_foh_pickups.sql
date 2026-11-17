-- Refill FOH from upstairs (Gold Class Bar): a front-of-house product can be grabbed from an
-- upstairs back-of-house spot (another checking area, e.g. "Wine cupboard" or "BOH bar fridge")
-- instead of coming straight from a downstairs storeroom. Safe to run more than once.
--
-- * pickup_area_id: the upstairs area it's grabbed from. In a full restock it's listed on the
--   "Refill FOH" step (grouped by that area), not on the downstairs collection list.
-- * pickup_suggest: also suggest the same amount for that product in the pickup area, so it's
--   replaced from downstairs (e.g. 1 Shiraz taken from the Wine cupboard → 1 Shiraz suggested
--   for the Wine cupboard). Staff can keep, change or remove the suggestion.
-- * unit_singular / unit_plural: count this product in a different unit in this area
--   (e.g. single bottles in the FOH beer fridge, packs in the BOH bar fridge).
alter table product_placements add column if not exists pickup_area_id uuid references check_areas(id) on delete set null;
alter table product_placements add column if not exists pickup_suggest boolean not null default false;
alter table product_placements add column if not exists unit_singular text;
alter table product_placements add column if not exists unit_plural text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_placements_unit_len') then
    alter table product_placements add constraint product_placements_unit_len check (
      (unit_singular is null or length(unit_singular) between 1 and 30) and (unit_plural is null or length(unit_plural) between 1 and 30));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_placements_pickup_not_self') then
    alter table product_placements add constraint product_placements_pickup_not_self check (pickup_area_id is null or pickup_area_id <> check_area_id);
  end if;
end $$;
create index if not exists product_placements_pickup_idx on product_placements (pickup_area_id) where pickup_area_id is not null;
