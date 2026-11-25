-- Gold Class Kitchen → Defrost: the check locations confirmed. Safe to run more than once. Only touches Gold Class
-- Kitchen (its Defrost rows, Stracciatella cheese and Grilled Chicken).
--
-- * Bao Buns, Grilled Chicken, Stracciatella cheese, Buns (Portioned Tubs), Naan Bread and 9" Pizza Bases are all
--   checked in the upstairs walk-in fridge: the "Check location to confirm" heading becomes "Upstairs walk-in fridge"
--   (just above the dessert shelf, which is in the same fridge).
-- * Stracciatella cheese is kept in the fridge, or frozen: "Check the fridge first" note; if more is needed a frozen
--   one is pulled from Freezer 1 (where it's kept frozen; no particular compartment) and goes into the upstairs
--   walk-in fridge to defrost. A compartment or destination a manager has already set is kept.
-- * Grilled Chicken is counted in packets (was portions), here and on the Freezer 2 spare stock check.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  def uuid; f1 uuid; pl uuid; n int;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  def := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'defrost' limit 1);
  if def is null then raise notice 'Defrost area not found: nothing changed'; return; end if;

  -- The group heading.
  update product_placements set heading = 'Upstairs walk-in fridge' where check_area_id = def and heading = 'Check location to confirm';
  get diagnostics n = row_count;

  -- Stracciatella: in the fridge, or frozen.
  pl := (select x.id from product_placements x join products q on q.id = x.product_id
         where x.check_area_id = def and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') like 'stracciatella%' limit 1);
  if pl is not null then
    f1 := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'freezer 1' limit 1);
    update product_placements set
      grab_note = coalesce(nullif(trim(grab_note), ''), 'Check the fridge first: if there''s none, defrost a frozen one'),
      put_note = coalesce(nullif(trim(put_note), ''), 'Upstairs walk-in fridge'),
      pickup_area_id = coalesce(pickup_area_id, f1)
      where id = pl;
  end if;

  -- Grilled Chicken: packets.
  update products set unit_singular = 'packet', unit_plural = 'packets'
    where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'grilledchicken'
      and lower(unit_singular) = 'portion' and lower(unit_plural) = 'portions';
  update product_placements x set unit_singular = 'packet', unit_plural = 'packets'
    from products q where q.id = x.product_id and q.department_id = dept
      and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = 'grilledchicken'
      and lower(x.unit_singular) = 'portion' and lower(x.unit_plural) = 'portions';

  raise notice 'Defrost (% heading renamed): %', n, (select string_agg(case when x.heading is not null then '[' || x.heading || '] ' else '' end || q.name, ', ' order by x.sort_order)
    from product_placements x join products q on q.id = x.product_id where x.check_area_id = def and q.status = 'active');
  raise notice 'Stracciatella: %', coalesce((select coalesce(x.grab_note, '') || ' · from ' || coalesce(c.name, 'not set') || ' → ' || coalesce(x.put_note, '')
    from product_placements x left join check_areas c on c.id = x.pickup_area_id where x.id = pl), 'not found');
  raise notice 'Grilled Chicken unit: %', (select string_agg(unit_singular || '/' || unit_plural, ', ') from products
    where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'grilledchicken');
end $$;
