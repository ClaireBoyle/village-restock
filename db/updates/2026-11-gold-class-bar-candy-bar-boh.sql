-- Gold Class Bar: popcorn boxes, cups, lids and (regular) straws are collected from Candy Bar BOH.
-- Milkshake straws and short straws keep their own storeroom. Safe to run more than once.
-- (Confection already comes from Candy Bar BOH: see 2026-11-gold-class-bar-confection.sql.)
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  boh uuid := (select id from storage_locations where lower(name) = 'candy bar boh');
  n int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if boh is null then raise exception 'The storeroom "Candy Bar BOH" must exist first'; end if;
  update products set default_location_id = boh
    where department_id = dept and status = 'active'
      and (lower(name) like 'popcorn box %' or lower(name) like 'cup %' or lower(name) like 'lid %' or lower(name) = 'straws');
  get diagnostics n = row_count;
  -- An area-specific storeroom on these products would override the product's: clear it.
  update product_placements pl set location_id = null from products p
    where pl.product_id = p.id and p.department_id = dept and pl.location_id is not null
      and (lower(p.name) like 'popcorn box %' or lower(p.name) like 'cup %' or lower(p.name) like 'lid %' or lower(p.name) = 'straws');
  raise notice '% products now collected from Candy Bar BOH', n;
end $$;
