-- Candy Bar confection stand: everything collected from Dry storage, with an open-box reminder.
-- Safe to run more than once. Only touches Candy Bar's Confection stand products and Dry storage's reminder.
--
-- * Every confection product on the stand is collected from Dry storage (staff enter one total per
--   product, from opened and new boxes together).
-- * Anything that's also in the FOH drinks fridge keeps its storeroom (the water stand's Mount Franklin
--   stays with the walk-in fridge), and the FOH drinks fridge is not touched.
-- * Dry storage's reminder on collection lists: "Use stock from the open-box shelf first. Only open a new
--   box if you still need more." (only set if Dry storage has no reminder yet, or still has this one).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'candy bar');
  dry uuid := (select id from storage_locations where lower(name) = 'dry storage');
  stand uuid; fridge uuid; n int;
begin
  if dept is null then raise notice 'Candy Bar not found: nothing changed'; return; end if;
  if dry is null then raise exception 'The storeroom "Dry storage" must exist first'; end if;
  stand := (select id from check_areas where department_id = dept and active and lower(name) = 'confection stand' limit 1);
  fridge := (select id from check_areas where department_id = dept and lower(name) = 'foh drinks fridge' limit 1);
  if stand is null then raise notice 'Candy Bar has no Confection stand: nothing changed'; return; end if;

  -- Confection only: not the water (or anything else that's also in the drinks fridge).
  update products p set default_location_id = dry
    where p.department_id = dept
      and exists (select 1 from product_placements x where x.product_id = p.id and x.check_area_id = stand)
      and not exists (select 1 from product_placements x where x.product_id = p.id and x.check_area_id = fridge)
      and lower(p.name) not like 'mount franklin%';
  update product_placements x set location_id = null
    from products p where p.id = x.product_id and x.check_area_id = stand and p.default_location_id = dry;
  get diagnostics n = row_count;

  update storage_locations set collect_note = 'Use stock from the open-box shelf first. Only open a new box if you still need more.'
    where id = dry and (trim(coalesce(collect_note, '')) = '' or collect_note like 'Use stock from the open-box shelf first%');

  raise notice 'Confection stand: % products collected from Dry storage, % from elsewhere', n,
    (select count(*) from product_placements x join products p on p.id = x.product_id
     where x.check_area_id = stand and coalesce(x.location_id, p.default_location_id) <> dry);
end $$;
