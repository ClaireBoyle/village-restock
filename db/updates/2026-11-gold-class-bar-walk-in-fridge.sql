-- Gold Class Bar Walk in fridge, in the order of the shelves (top to bottom, left to right, from the
-- photo of the fridge), with one small heading per shelf. Safe to run more than once.
-- Only touches the Gold Class Bar "Walk in fridge" checking area.
--
--   Top shelf · Fruit & Juices:  Maraschino Cherries, Orange / Pineapple / Apple / Cranberry Juice,
--                                Limes, Lemons (both counted in boxes), Oranges, Strawberries, Passionfruit
--   Middle shelf · Wine:         Moscato, Chandon NV, Redbank Prosecco, Cloudy Bay Sauvignon Blanc,
--                                Red Claw Pinot Gris, Red Claw Chardonnay, Mt Yengo Pinot Grigio,
--                                Alexander Hill Rosé, Alexander Hill Sauvignon Blanc, Alexander Hill Brut Cuvée
--   Bottom shelf · Water & Wine: Mount Franklin Still Water, Pewsey Vale Riesling, Minuty M Rosé,
--                                Chandon Rosé NV, Moet Rosé, Moet Chandon, Veuve Clicquot, Twin Islands Sauvignon Blanc
--   Anything else already in the fridge stays, at the end.
--
-- * Existing products are reused (the juices from the BOH bar fridge): same product, so the
--   collection list adds them up. Their names, units and photos are kept. Missing ones are added.
-- * All staff-entered, no targets, collected from Walk in fridge(Downstairs).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  walkin uuid := (select id from storage_locations where lower(name) = 'walk in fridge(downstairs)');
  area uuid;
  -- name, unit (one), unit (more), category, heading above it
  -- products to add if missing: name, unit (one), unit (more), category
  list text[][] := array[
    ['Maraschino Cherries', 'jar', 'jars', 'Fresh Produce'],
    ['Orange Juice', 'bottle', 'bottles', 'Juices & Water'],
    ['Pineapple Juice', 'bottle', 'bottles', 'Juices & Water'],
    ['Apple Juice', 'bottle', 'bottles', 'Juices & Water'],
    ['Cranberry Juice', 'bottle', 'bottles', 'Juices & Water'],
    ['Limes', 'box', 'boxes', 'Fresh Produce'],
    ['Lemons', 'box', 'boxes', 'Fresh Produce'],
    ['Oranges', 'orange', 'oranges', 'Fresh Produce'],
    ['Strawberries', 'punnet', 'punnets', 'Fresh Produce'],
    ['Passionfruit', 'passionfruit', 'passionfruit', 'Fresh Produce'],
    ['Mount Franklin Still Water', 'bottle', 'bottles', 'Juices & Water']
  ];
  -- the whole fridge in shelf order: name, heading above it
  shelf text[][] := array[
    ['Maraschino Cherries', 'Top shelf · Fruit & Juices'],
    ['Orange Juice', ''], ['Pineapple Juice', ''], ['Apple Juice', ''], ['Cranberry Juice', ''],
    ['Limes', ''], ['Lemons', ''], ['Oranges', ''], ['Strawberries', ''], ['Passionfruit', ''],
    ['Dunes & Greene Split Pick Moscato', 'Middle shelf · Wine'],
    ['Chandon NV', ''], ['Redbank King Valley Prosecco NV', ''], ['Cloudy Bay Sauvignon Blanc', ''],
    ['Red Claw Pinot Gris', ''], ['Red Claw Chardonnay', ''], ['Mt Yengo Pinot Grigio', ''],
    ['Alexander Hill Rosé', ''], ['Alexander Hill Sauvignon Blanc', ''], ['Alexander Hill Brut Cuvée', ''],
    ['Mount Franklin Still Water', 'Bottom shelf · Water & Wine'],
    ['Pewsey Vale Riesling', ''], ['Minuty M Rosé', ''], ['Chandon Rosé NV', ''], ['Moet Rosé', ''],
    ['Moet Chandon', ''], ['Veuve Clicquot', ''], ['Twin Islands Sauvignon Blanc', '']
  ];
  i int; p uuid; pl uuid; cat uuid; top uuid[] := '{}';
  k int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if walkin is null then raise exception 'The storeroom "Walk in fridge(Downstairs)" must exist first'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  area := (select id from check_areas where department_id = dept and lower(name) = 'walk in fridge');
  if area is null then raise notice 'Gold Class Bar has no "Walk in fridge" area: nothing changed'; return; end if;

  -- 1. The 11 products (reused or added) and their place in the fridge.
  for i in 1 .. array_length(list, 1) loop
    insert into categories (department_id, name, sort_order) select dept, list[i][4], 100
      where not exists (select 1 from categories where department_id = dept and lower(name) = lower(list[i][4]));
    cat := (select id from categories where department_id = dept and lower(name) = lower(list[i][4]));
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][1], list[i][2], list[i][3], 'manual', walkin, 600 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat),
        default_location_id = coalesce(default_location_id, walkin) where id = p;
      -- Lemons and limes are counted in boxes (if they were set up as single fruit by an earlier run).
      update products set unit_singular = 'box', unit_plural = 'boxes'
        where id = p and lower(name) in ('lemons', 'limes') and lower(unit_singular) in ('lemon', 'lime');
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, 0) returning id into pl; end if;
    update product_placements set par_level = null, location_id = null where id = pl;
  end loop;

  -- 2. Shelf order. Products not found by name are skipped; anything else in the fridge goes last.
  k := 0;
  for i in 1 .. array_length(shelf, 1) loop
    pl := (select q.id from product_placements q join products pr on pr.id = q.product_id
           where q.check_area_id = area and lower(pr.name) = lower(shelf[i][1]) and pr.status = 'active' limit 1);
    continue when pl is null;
    k := k + 1;
    update product_placements set sort_order = k, heading = nullif(shelf[i][2], '') where id = pl;
    top := top || pl;
  end loop;
  for pl in select q.id from product_placements q where q.check_area_id = area and not (q.id = any(top)) order by q.sort_order, q.created_at loop
    k := k + 1;
    update product_placements set sort_order = k, heading = null where id = pl;
  end loop;
  raise notice 'Walk in fridge: % products arranged', k;
end $$;
