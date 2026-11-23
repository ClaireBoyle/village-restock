-- Gold Class Bar: the malt powder container at the milkshake station is a "Needs refill" task, refilled from the
-- malt powder in the Coffee cupboard. Safe to run more than once. Run AFTER db/migrations/026_area_reminders.sql
-- and the earlier Gold Class Bar scripts. Only touches Gold Class Bar.
--
-- * Milkshake station: "Malt powder container", after the Cadbury Flake container. Tap Needs refill (no amount).
-- * Coffee cupboard: once ticked, a reminder at the top ("Refill while you're here: Malt powder container"), ticked
--   off there. It isn't put on the downstairs collection list.
-- * Malt powder stays a stock item in the Coffee cupboard, entered as usual when it needs collecting from downstairs.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  shake uuid; coffee uuid; store uuid; p uuid; pl uuid; at int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'remind_area_id') then
    raise exception 'Run db/migrations/026_area_reminders.sql first';
  end if;
  shake := (select id from check_areas where department_id = dept and active and lower(name) = 'milkshake station' limit 1);
  coffee := (select id from check_areas where department_id = dept and active and lower(name) = 'coffee cupboard' limit 1);
  if shake is null or coffee is null then raise exception 'Milkshake station or Coffee cupboard not found'; end if;
  store := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('alcoholstoreroom', 'alcoholstore') order by sort_order limit 1);

  -- The refill task.
  p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('maltpowdercontainer', 'maltcontainer')
        order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, instructions, sort_order)
      values (dept, 'Malt powder container', 'container', 'containers', 'routine', store, 'Refill it from the malt powder in the coffee cupboard.',
              (select coalesce(max(sort_order), 0) + 1 from products where department_id = dept)) returning id into p;
  else
    update products set status = 'active', method = 'routine' where id = p;
  end if;
  pl := (select id from product_placements where product_id = p and check_area_id = shake limit 1);
  if pl is null then
    -- After the Cadbury Flake container (the rows after it move down one), or at the end.
    at := (select x.sort_order from product_placements x join products q on q.id = x.product_id
           where x.check_area_id = shake and q.status = 'active' and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') like '%flake%' order by x.sort_order desc limit 1);
    if at is null then at := (select coalesce(max(sort_order), 0) from product_placements where check_area_id = shake); end if;
    update product_placements set sort_order = sort_order + 1 where check_area_id = shake and sort_order > at;
    insert into product_placements (product_id, check_area_id, sort_order) values (p, shake, at + 1) returning id into pl;
  end if;
  update product_placements set remind_area_id = coffee, pickup_area_id = null, pickup_suggest = false, par_level = null where id = pl;

  -- Malt powder itself: still a Coffee cupboard stock item (added at the end if it isn't there).
  p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('maltpowder', 'malt')
        order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, 'Malt powder', 'tin', 'tins', 'manual', store, (select coalesce(max(sort_order), 0) + 1 from products where department_id = dept)) returning id into p;
  end if;
  if not exists (select 1 from product_placements where product_id = p and check_area_id = coffee) then
    insert into product_placements (product_id, check_area_id, sort_order) values (p, coffee, (select coalesce(max(sort_order), 0) + 1 from product_placements where check_area_id = coffee));
  end if;

  raise notice 'Milkshake station: %', (select string_agg(q.name || case when x.remind_area_id is not null then ' (needs refill, reminder in the Coffee cupboard)' else '' end, ', ' order by x.sort_order)
    from product_placements x join products q on q.id = x.product_id where x.check_area_id = shake and q.status = 'active');
  raise notice 'Coffee cupboard stock: Malt powder (%)', (select q.method from products q where q.id = p);
end $$;
