-- Gold Class Bar: Check FOH follows the lap of the bar (from the bar map). Run AFTER
-- 2026-11-gold-class-bar-back-bench-walk.sql. Safe to run more than once. Only touches Gold Class Bar.
--
-- From the bar door, down the right-hand side, then back up the left:
--   1 FOH freezer               (the confection wall is alongside)
--   2 Confection
--   3 Popcorn boxes
--   4 Back bench                from the sink: liqueurs & vermouth, cocktail syrups & mixers, spirits & red wine
--   5 Back shelves              the glass shelves above the bench
--   6 Milkshake station         NEW: the milkshake syrups and the Flake container, moved from the Back bench
--   7 Cups, Lids & Straws       cups & lids, then the straw drawer
--   8 Coffee cupboard           Coffee supplies (beans, hot chocolate, cordial), then Coffee machine (sugar container)
--   9 FOH beer fridge           last, straight before the BOH bar fridge its beers are grabbed from
-- Then Check BOH: BOH bar fridge, Walk in fridge, Upstairs cupboards.
--
-- * Products are moved, not copied: same records, units, photos and pickups (the Flake container is
--   still a "Needs refill" task from the upstairs cupboard).
-- * Any other area keeps its place after these.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  bench uuid; shake uuid; coffee uuid; a uuid; r record; k int := 0; i int; s int;
  -- the lap: area name pattern (like), in order
  lap text[] := array['foh freezer', 'confection%', 'popcorn%', 'back bench', 'back shelves', 'milkshake station',
                      'cups%lids%', 'coffee cupboard', 'foh beer fridge', 'boh bar fridge', 'walk in fridge%', 'upstairs cupboards'];
  shakes text[] := array['vanilla syrup', 'caramel syrup', 'mint syrup', 'strawberry syrup', 'chocolate syrup', 'banana syrup',
                         'cherry syrup', 'orange syrup', 'cadbury flake container'];
  done uuid[] := '{}';
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  bench := (select id from check_areas where department_id = dept and active and lower(name) = 'back bench' limit 1);
  coffee := (select id from check_areas where department_id = dept and active and lower(name) = 'coffee cupboard' limit 1);
  if bench is null or coffee is null then raise exception 'Run 2026-11-gold-class-bar-back-bench-walk.sql first'; end if;

  -- 1. The Milkshake station, with the milkshake end of the bench moved into it (in the same order).
  shake := (select id from check_areas where department_id = dept and lower(name) = 'milkshake station' order by active desc limit 1);
  if shake is null then
    insert into check_areas (department_id, name, sort_order, guide_text)
      values (dept, 'Milkshake station', 0, 'The milkshake machine end of the bench: the syrups, then the Flake container.') returning id into shake;
  end if;
  update check_areas set active = true, parent_area_id = null where id = shake;
  for i in 1 .. array_length(shakes, 1) loop
    for r in select x.id, x.product_id from product_placements x join products p on p.id = x.product_id
             where x.check_area_id = bench and lower(p.name) = shakes[i] loop
      if exists (select 1 from product_placements where product_id = r.product_id and check_area_id = shake) then
        delete from product_placements where id = r.id;
      else
        update product_placements set check_area_id = shake where id = r.id;
      end if;
    end loop;
    update product_placements x set sort_order = i, heading = null
      from products p where p.id = x.product_id and x.check_area_id = shake and lower(p.name) = shakes[i];
  end loop;
  -- The bench now ends with the spirits and red wine: renumber it (keeping its order and headings).
  k := 0;
  for r in select id from product_placements where check_area_id = bench order by sort_order, created_at loop
    k := k + 1; update product_placements set sort_order = k where id = r.id;
  end loop;
  update check_areas set guide_text = 'From the sink: liqueurs & vermouth, syrups & mixers, then spirits & red wine on the benchtop. Add only what needs topping up.'
    where id = bench and (trim(coalesce(guide_text, '')) = '' or guide_text like 'From the sink to the milkshake machine%');

  -- 2. Coffee cupboard: the supplies first, then the sugar container at the coffee machine
  --    (skipped once 2026-11-gold-class-bar-coffee-cupboard.sql has given the sugar its own tab).
  k := 0;
  for r in select x.id, lower(p.name) = 'sugar container' as sugar from product_placements x join products p on p.id = x.product_id
           where x.check_area_id = coffee
             and exists (select 1 from product_placements y join products q on q.id = y.product_id where y.check_area_id = coffee and lower(q.name) = 'sugar container')
           order by (lower(p.name) = 'sugar container'), x.sort_order, x.created_at loop
    k := k + 1;
    update product_placements set sort_order = k,
      heading = case when r.sugar then 'Coffee machine' when k = 1 then 'Coffee supplies' else null end where id = r.id;
  end loop;
  update check_areas set guide_text = 'The coffee supplies cupboard, then the sugar container at the coffee machine. Add only what needs topping up.'
    where id = coffee and (trim(coalesce(guide_text, '')) = '' or guide_text like 'The cupboard next to the coffee machine%');

  -- 3. Areas in lap order (top-level areas only; sections stay inside their area).
  k := 0;
  for i in 1 .. array_length(lap, 1) loop
    for a in select id from check_areas where department_id = dept and active and parent_area_id is null
             and lower(name) like lap[i] and not (id = any(done)) order by sort_order loop
      k := k + 1; update check_areas set sort_order = k where id = a; done := done || a;
    end loop;
  end loop;
  for a in select id from check_areas where department_id = dept and parent_area_id is null and not (id = any(done)) order by active desc, sort_order loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;

  raise notice 'Gold Class Bar lap: % areas; Milkshake station: % products; Back bench: % products', array_length(done, 1),
    (select count(*) from product_placements where check_area_id = shake), (select count(*) from product_placements where check_area_id = bench);
end $$;
