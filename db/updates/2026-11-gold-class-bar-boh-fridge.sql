-- Gold Class Bar: BOH bar fridge in physical order (top to bottom, left to right), 25 products
-- (the 24 listed plus Whipping Cream beside Whipped Cream),
-- with two subheadings. Run AFTER db/migrations/011_placement_headings.sql. Safe to run more than once.
--
-- * Existing products are updated, never duplicated (matched by name within Gold Class Bar);
--   their ids, photos and pack units are kept. Missing products are added.
-- * Every product: staff enter what they need (no target levels).
-- * Collected from: mixers, water, milk and cream: Walk in fridge(Downstairs); beer, cider, hard soda: Alcohol storeroom.
-- * Other areas and departments are not touched.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  area uuid;
  walkin uuid := (select id from storage_locations where lower(name) = 'walk in fridge(downstairs)');
  alc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  -- name, unit (one), unit (more), storeroom (w = walk-in fridge, a = alcohol storeroom), heading above it
  list text[][] := array[
    ['Cranberry Juice', 'bottle', 'bottles', 'w', 'Mixers, Water & Milk'],
    ['Orange Juice', 'bottle', 'bottles', 'w', ''],
    ['Apple Juice', 'bottle', 'bottles', 'w', ''],
    ['Pineapple Juice', 'bottle', 'bottles', 'w', ''],
    ['Mount Franklin Sparkling Water 750ml', 'bottle', 'bottles', 'w', ''],
    ['Skinny Milk', 'container', 'containers', 'w', ''],
    ['Kirks Indian Tonic Water', 'bottle', 'bottles', 'w', ''],
    ['Kirks Dry Ginger Ale', 'bottle', 'bottles', 'w', ''],
    ['Whipped Cream', 'can', 'cans', 'w', ''],
    ['Whipping Cream', 'carton', 'cartons', 'w', ''],
    ['Oat Milk', 'container', 'containers', 'w', ''],
    ['Soy Milk', 'container', 'containers', 'w', ''],
    ['Mount Franklin Sparkling Water 330ml', 'bottle', 'bottles', 'w', ''],
    ['Heineken Zero', 'pack', 'packs', 'a', 'Beer, Cider & Hard Soda'],
    ['James Squire Ginger Beer', 'pack', 'packs', 'a', ''],
    ['Little Creatures Rogers', 'pack', 'packs', 'a', ''],
    ['Hahn Superdry 3.5', 'pack', 'packs', 'a', ''],
    ['Guinness', 'pack', 'packs', 'a', ''],
    ['Stone & Wood Pacific Ale', 'pack', 'packs', 'a', ''],
    ['Little Creatures Pipsqueak Cider', 'pack', 'packs', 'a', ''],
    ['James Boags Premium', 'pack', 'packs', 'a', ''],
    ['Kirin Ichiban', 'pack', 'packs', 'a', ''],
    ['Heineken', 'pack', 'packs', 'a', ''],
    ['Furphy', 'pack', 'packs', 'a', ''],
    ['Suntory -196 Lemon', 'pack', 'packs', 'a', '']
  ];
  i int; p uuid; pl uuid; loc uuid; keep uuid[] := '{}';
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if walkin is null or alc is null then raise exception 'Storerooms "Walk in fridge(Downstairs)" and "Alcohol storeroom" must exist first'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  area := (select id from check_areas where department_id = dept and lower(name) = 'boh bar fridge');
  if area is null then
    insert into check_areas (department_id, name, sort_order) values (dept, 'BOH bar fridge', 1) returning id into area;
  end if;
  -- The fridge's one-line reminder (only if the area has no instruction yet).
  update check_areas set guide_text = 'Refill FOH first.' where id = area and trim(guide_text) = '';

  for i in 1 .. array_length(list, 1) loop
    loc := case when list[i][4] = 'w' then walkin else alc end;
    -- Existing product (any status), matched by name within Gold Class Bar.
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, list[i][1], list[i][2], list[i][3], 'manual', loc, 500 + i) returning id into p;
    else
      -- Keep name, units, photo and id; just make sure it's active, staff-entered and collected from the right place.
      update products set status = 'active', method = 'manual', default_location_id = loc where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl;
    end if;
    update product_placements set sort_order = i, par_level = null, location_id = null,
      heading = nullif(list[i][5], '') where id = pl;
    keep := keep || pl;
  end loop;
  -- Anything else already in this fridge stays, after the 24, without a heading.
  update product_placements set sort_order = 100 + sort_order, heading = null where check_area_id = area and not (id = any(keep));
  raise notice 'BOH bar fridge: % products arranged', array_length(keep, 1);
end $$;
