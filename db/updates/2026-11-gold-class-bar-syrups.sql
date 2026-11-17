-- Gold Class Bar syrups, kept on the Back bench only (no upstairs overflow). Safe to run more than once.
--   Syrups: Vanilla, Caramel, Mint, Strawberry, Chocolate, Banana, Cherry, Orange, Raspberry,
--           Elderflower, Rose, Pure Cane Sugar
-- * At the end of the Back bench under a "Syrups" heading. Staff enter bottles needed (no targets).
-- * Collected from the Alcohol storeroom (change it in Admin > Products if they're kept elsewhere).
-- * Not added to any cupboard, so the Back bench shows no "Grab it from…" note for them.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  loc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  bench uuid; cat uuid; p uuid; pl uuid; i int; k int;
  list text[] := array['Vanilla Syrup', 'Caramel Syrup', 'Mint Syrup', 'Strawberry Syrup', 'Chocolate Syrup', 'Banana Syrup',
    'Cherry Syrup', 'Orange Syrup', 'Raspberry Syrup', 'Elderflower Syrup', 'Rose Syrup', 'Pure Cane Sugar Syrup'];
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  bench := (select id from check_areas where department_id = dept and lower(name) = 'back bench' and active);
  if bench is null then raise notice 'No Back bench in Gold Class Bar: nothing changed'; return; end if;
  insert into categories (department_id, name, sort_order) select dept, 'Syrups', 100
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'syrups');
  cat := (select id from categories where department_id = dept and lower(name) = 'syrups');
  -- After everything else on the bench (syrups already there keep their spot at the end).
  k := coalesce((select max(pl2.sort_order) from product_placements pl2 join products p2 on p2.id = pl2.product_id
                 where pl2.check_area_id = bench and not (p2.name = any(list))), 0);
  for i in 1 .. array_length(list, 1) loop
    p := (select id from products where department_id = dept and lower(name) = lower(list[i]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i], 'bottle', 'bottles', 'manual', loc, 1000 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat),
        default_location_id = coalesce(default_location_id, loc) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = bench limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, bench, 0) returning id into pl; end if;
    update product_placements set sort_order = k + i, par_level = null, location_id = null,
      heading = case when i = 1 then 'Syrups' else null end where id = pl;
  end loop;
  raise notice 'Back bench: % syrups', array_length(list, 1);
end $$;
