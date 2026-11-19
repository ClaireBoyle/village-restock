-- Gold Class Bar: fresh mint, in the Walk in fridge with the fresh fruit (after the passionfruit).
-- Safe to run more than once. Only touches Gold Class Bar.
-- * "Staff enter" (manual), Fresh Produce, collected from the downstairs walk-in fridge, like the fruit.
-- * Counted in bunches (a guess: change it in Admin → Products if it's bought another way).
-- * An existing "Mint" product in the Bar is reused, never duplicated.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  walk uuid; p uuid; pl uuid; after int; cat uuid; loc uuid;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfridge%' order by sort_order limit 1);
  if walk is null then raise exception 'Gold Class Bar''s "Walk in fridge" area must exist first'; end if;
  cat := (select id from categories where department_id = dept and lower(name) = 'fresh produce' limit 1);
  -- Where the fruit comes from (the downstairs walk-in fridge).
  loc := coalesce(
    (select coalesce(x.location_id, q.default_location_id) from product_placements x join products q on q.id = x.product_id
      where x.check_area_id = walk and lower(q.name) = 'passionfruit' limit 1),
    (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfridge%' order by sort_order limit 1));

  p := (select id from products where department_id = dept and lower(name) in ('mint', 'fresh mint') order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, cat, 'Mint', 'bunch', 'bunches', 'manual', loc, 999) returning id into p;
  else
    update products set status = 'active', category_id = coalesce(category_id, cat), default_location_id = coalesce(default_location_id, loc) where id = p;
  end if;

  pl := (select id from product_placements where product_id = p and check_area_id = walk limit 1);
  if pl is null then
    -- Straight after the passionfruit (or the last fruit), everything after it moves down one.
    after := coalesce(
      (select x.sort_order from product_placements x join products q on q.id = x.product_id where x.check_area_id = walk and lower(q.name) = 'passionfruit' limit 1),
      (select max(x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = walk and q.category_id = cat),
      (select max(sort_order) from product_placements where check_area_id = walk), 0);
    update product_placements set sort_order = sort_order + 1 where check_area_id = walk and sort_order > after;
    insert into product_placements (product_id, check_area_id, sort_order, heading) values (p, walk, after + 1, null) returning id into pl;
  end if;

  raise notice 'Gold Class Bar: Mint in the Walk in fridge, after the passionfruit (collected from %)', (select name from storage_locations where id = loc);
end $$;
