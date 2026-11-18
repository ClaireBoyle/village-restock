-- Gold Class Kitchen: a "Defrost" section, first in the Kitchen restock. Safe to run more than once.
-- Run AFTER db/migrations/016_defrost_rows.sql. Only touches Gold Class Kitchen (plus two new storerooms).
--
-- Every item is its own row. Staff enter how many to pull, or tap Not needed. Each row says where to
-- grab it, where to look if that's empty (where confirmed), and where it goes. The collection list is
-- grouped by the freezer it's pulled from (Freezer 1, Freezer 2).
--
--   Pulled beef for bao     Freezer 1 · 1 kg bags (what's ready is counted in portions)
--   Bao buns                Freezer 1
--   Beef patties            Freezer 1 → downstairs walk-in freezer
--   Buns (portioned tubs)   Freezer 1 → downstairs walk-in freezer · pulled by the tub (ready counted in buns)
--   9" pizza bases          Freezer 1 → downstairs walk-in freezer
--   Grilled chicken         Freezer 2 → downstairs walk-in freezer
--   Naan bread              Freezer 1 overflow → downstairs walk-in freezer
--   Desserts (9)            Freezer 1 overflow → downstairs walk-in freezer
--
-- * No admits targets are set yet, so there are no suggestions: staff enter every amount. Targets and
--   unit conversions (e.g. portions per 1 kg bag, buns per tub) can be added per item in Admin.
-- * Notes and units already changed in Admin are kept (only blank ones are filled in).
-- * More items can be added in Admin (Products → add to the Defrost area).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  f1 uuid; f2 uuid; area uuid; cat uuid; p uuid; pl uuid; i int; loc uuid;
  -- name, unit (one), unit (more), freezer ('1' or '2'), grab, if empty, put, ready unit (one), ready unit (more), heading
  list text[][] := array[
    ['Pulled Beef (Bao)', 'bag', 'bags', '1',
     'Check the portioned beef in the under-salad-bar bench fridge first. If more is needed: 1 kg brown bag, Freezer 1, lower-left door, bottom shelf (under the 9" pizza bases).',
     '', 'Upstairs walk-in fridge, for the morning team to portion', 'portion', 'portions', 'Mains & breads'],
    ['Bao Buns', 'bun', 'buns', '1', 'Freezer 1, lower-right door, lower shelf: Bao Buns tub', '', 'Upstairs walk-in fridge', '', '', ''],
    ['Beef Patties', 'patty', 'patties', '1', 'Freezer 1',
     'Take containers to the downstairs walk-in freezer and bring back frozen patties to refill Freezer 1',
     'Right side of the under-salad-bar bench fridge', '', '', ''],
    ['Buns (Portioned Tubs)', 'tub', 'tubs', '1', 'Freezer 1', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, in the portioned tubs', 'bun', 'buns', ''],
    ['9" Pizza Bases', 'base', 'bases', '1', 'Freezer 1, lower-left door: the labelled 9" Pizza Bases drawer', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge', '', '', ''],
    ['Grilled Chicken', 'portion', 'portions', '2', 'Freezer 2: portioned stock', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge', '', '', ''],
    ['Naan Bread', 'piece', 'pieces', '1', 'Freezer 1 overflow, lower-right door, lower shelf: Naan Bread tub', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge', '', '', ''],
    ['Basque Cheesecake', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', 'Desserts'],
    ['Chocolate Mousse Cake', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Sour Cherry Gel', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Golden Crumb', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Passionfruit Sponge', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Raspberry Coulis', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Salted Caramel Sauce', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Brownie', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', ''],
    ['Sticky Date', 'portion', 'portions', '1', 'Freezer 1 overflow', 'Downstairs walk-in freezer', 'Upstairs walk-in fridge, right-hand dessert shelf', '', '', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'grab_note') then
    raise exception 'Run db/migrations/016_defrost_rows.sql first';
  end if;

  -- 1. The two kitchen freezers, as storerooms (the collection list is grouped by them).
  if not exists (select 1 from storage_locations where lower(name) = 'freezer 1') then
    insert into storage_locations (name, sort_order) values ('Freezer 1', coalesce((select max(sort_order) from storage_locations), 0) + 1);
  end if;
  if not exists (select 1 from storage_locations where lower(name) = 'freezer 2') then
    insert into storage_locations (name, sort_order) values ('Freezer 2', coalesce((select max(sort_order) from storage_locations), 0) + 1);
  end if;
  f1 := (select id from storage_locations where lower(name) = 'freezer 1');
  f2 := (select id from storage_locations where lower(name) = 'freezer 2');
  update storage_locations set active = true where id in (f1, f2);

  -- 2. The Defrost area, first in the Kitchen.
  area := (select id from check_areas where department_id = dept and lower(name) = 'defrost' order by active desc limit 1);
  if area is null then
    insert into check_areas (department_id, name, sort_order) values (dept, 'Defrost', 0) returning id into area;
  end if;
  update check_areas set active = true, sort_order = coalesce((select min(sort_order) from check_areas where department_id = dept and id <> area and active), 1) - 1
    where id = area;
  update check_areas set parent_area_id = null where id = area;
  update check_areas set guide_text = 'For tomorrow: enter how many to pull, or tap Not needed. Each item says where to grab it and where it goes.'
    where id = area and trim(coalesce(guide_text, '')) = '';

  insert into categories (department_id, name, sort_order) select dept, 'Defrost', 1
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'defrost');
  cat := (select id from categories where department_id = dept and lower(name) = 'defrost');

  -- 3. Every item, its own row.
  for i in 1 .. array_length(list, 1) loop
    loc := case list[i][4] when '2' then f2 else f1 end;
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][1], list[i][2], list[i][3], 'manual', loc, i) returning id into p;
    else
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat), default_location_id = coalesce(default_location_id, loc) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl;
      update product_placements set heading = nullif(list[i][10], '') where id = pl;
    end if;
    update product_placements set sort_order = i, par_level = null,
      grab_note = coalesce(nullif(trim(grab_note), ''), nullif(list[i][5], '')),
      fallback_note = coalesce(nullif(trim(fallback_note), ''), nullif(list[i][6], '')),
      put_note = coalesce(nullif(trim(put_note), ''), nullif(list[i][7], '')),
      ready_unit_singular = coalesce(ready_unit_singular, nullif(list[i][8], '')),
      ready_unit_plural = coalesce(ready_unit_plural, nullif(list[i][9], ''))
      where id = pl;
  end loop;

  raise notice 'Defrost: % items in Gold Class Kitchen (% from Freezer 1, % from Freezer 2)',
    (select count(*) from product_placements where check_area_id = area),
    (select count(*) from product_placements x join products q on q.id = x.product_id where x.check_area_id = area and coalesce(x.location_id, q.default_location_id) = f1),
    (select count(*) from product_placements x join products q on q.id = x.product_id where x.check_area_id = area and coalesce(x.location_id, q.default_location_id) = f2);
end $$;
