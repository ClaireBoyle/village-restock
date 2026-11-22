-- Gold Class Kitchen Dry stock: what's on the shelves above the salad bar and at the dessert station.
-- Safe to run more than once. Run AFTER the earlier Gold Class Kitchen scripts (and 021_prep_checklist.sql).
-- Only touches Gold Class Kitchen.
--
--   Above salad bar    Baking Paper, Smokey Paprika, Oregano, Taco Seasoning, Hot Honey, Olive Oil, Vinegar Powder,
--                      Chicken Salt; then GC Seasoning (prepped: "Add prep" → "Make GC seasoning")
--   Dessert station    Chocolate Sauce, Lavosh Crackers, GF Crackers, Peanuts, Sesame Seeds, Corn Chips
--     Shelf above      Portioned Chocolate Sauce (prepped: "Add prep" → "Portion chocolate sauce"),
--                      Peanut Butter Sauce, Cinnamon Sugar
--
-- * Stock items: "staff enter" (Add only what's needed), collected from the Alcohol storeroom (not Dry storage
--   downstairs). Units as below (change them in Admin if needed).
-- * Prepped items (GC Seasoning, Portioned Chocolate Sauce): needed or not, never collected; the tick puts the task
--   on the next morning's prep list. Both tasks are also on the Prep checklist (Seasonings, Dessert prep).
-- * Existing products and rows are reused, never duplicated; notes changed in Admin are kept.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  dry uuid; salad uuid; dessert uuid; store uuid; area uuid; p uuid; pl uuid; t uuid; i int; norm text; added int := 0;
  checklist boolean := exists (select 1 from information_schema.columns where table_name = 'prep_tasks' and column_name = 'on_checklist');
  -- section, product, unit (one), unit (more), subheading, prep task ('' = stock), task group, checklist group, name on checklist
  items text[][] := array[
    ['salad', 'Baking Paper', 'roll', 'rolls', 'Dry goods and seasonings', '', '', '', ''],
    ['salad', 'Smokey Paprika', 'tub', 'tubs', '', '', '', '', ''],
    ['salad', 'Oregano', 'tub', 'tubs', '', '', '', '', ''],
    ['salad', 'Taco Seasoning', 'tub', 'tubs', '', '', '', '', ''],
    ['salad', 'Hot Honey', 'bottle', 'bottles', '', '', '', '', ''],
    ['salad', 'Olive Oil', 'bottle', 'bottles', '', '', '', '', ''],
    ['salad', 'Vinegar Powder', 'tub', 'tubs', '', '', '', '', ''],
    ['salad', 'Chicken Salt', 'tub', 'tubs', '', '', '', '', ''],
    ['salad', 'GC Seasoning', 'tub', 'tubs', 'Prepped', 'Make GC seasoning', 'other', 'Seasonings', 'GC seasoning'],
    ['dessert', 'Chocolate Sauce', 'bottle', 'bottles', 'Dessert station', '', '', '', ''],
    ['dessert', 'Lavosh Crackers', 'packet', 'packets', '', '', '', '', ''],
    ['dessert', 'GF Crackers', 'packet', 'packets', '', '', '', '', ''],
    ['dessert', 'Peanuts', 'bag', 'bags', '', '', '', '', ''],
    ['dessert', 'Sesame Seeds', 'bag', 'bags', '', '', '', '', ''],
    ['dessert', 'Corn Chips', 'bag', 'bags', '', '', '', '', ''],
    ['dessert', 'Portioned Chocolate Sauce', 'bottle', 'bottles', 'Shelf above', 'Portion chocolate sauce', 'sauces', 'Dessert prep', 'Portion chocolate sauce'],
    ['dessert', 'Peanut Butter Sauce', 'bottle', 'bottles', '', '', '', '', ''],
    ['dessert', 'Cinnamon Sugar', 'tub', 'tubs', '', '', '', '', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if to_regclass('public.prep_tasks') is null then raise exception 'Run db/migrations/017_morning_prep.sql first'; end if;
  dry := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'drystock' limit 1);
  if dry is null then raise exception 'Run 2026-11-gold-class-kitchen-upstairs-areas.sql first (Dry stock)'; end if;
  -- Dry stock comes from the Alcohol storeroom (not Dry storage downstairs).
  store := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('alcoholstoreroom', 'alcoholstore') order by sort_order limit 1);
  update check_areas set guide_text = 'Add only what needs topping up. It comes up from the Alcohol storeroom.'
    where id = dry and guide_text = 'Add only what needs topping up. It comes up from Dry storage.';

  -- The two sections, on the Dry stock screen.
  salad := (select id from check_areas where department_id = dept and lower(name) = lower('Dry stock · Above salad bar') limit 1);
  if salad is null then insert into check_areas (department_id, name, sort_order) values (dept, 'Dry stock · Above salad bar', 1) returning id into salad; end if;
  dessert := (select id from check_areas where department_id = dept and lower(name) = lower('Dry stock · Dessert station') limit 1);
  if dessert is null then insert into check_areas (department_id, name, sort_order) values (dept, 'Dry stock · Dessert station', 2) returning id into dessert; end if;
  update check_areas set active = true, parent_area_id = dry, section_mode = 'open', sort_order = 1,
    guide_text = case when trim(coalesce(guide_text, '')) = '' then 'Shelves above the salad bar: dry goods and seasonings, with the prepped GC seasoning at the end.' else guide_text end
    where id = salad;
  update check_areas set active = true, parent_area_id = dry, section_mode = 'open', sort_order = 2,
    guide_text = case when trim(coalesce(guide_text, '')) = '' then 'Dessert station, then the shelf above (portioned chocolate sauce, peanut butter sauce, cinnamon sugar).' else guide_text end
    where id = dessert;

  for i in 1 .. array_length(items, 1) loop
    area := case when items[i][1] = 'salad' then salad else dessert end;
    -- Prepped: its morning prep task (on the handover and the Prep checklist).
    t := null;
    if items[i][6] <> '' then
      t := (select id from prep_tasks where department_id = dept and lower(name) = lower(items[i][6]));
      if t is null then
        insert into prep_tasks (department_id, grp, name, sort_order)
          values (dept, items[i][7], items[i][6], coalesce((select max(sort_order) from prep_tasks where department_id = dept), 0) + 1) returning id into t;
      end if;
      update prep_tasks set active = true where id = t;
      if checklist then
        execute 'update prep_tasks set on_checklist = true, checklist_group = coalesce(checklist_group, $2), checklist_name = coalesce(checklist_name, $3) where id = $1'
          using t, items[i][8], items[i][9];
      end if;
    end if;

    norm := regexp_replace(lower(items[i][2]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, items[i][2], items[i][3], items[i][4], 'manual', case when t is null then store else null end, 1000 + i) returning id into p;
      added := added + 1;
    else
      update products set status = 'active' where id = p and status <> 'active';
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl; end if;
    update product_placements set sort_order = i, heading = nullif(items[i][5], ''), prep_task_id = t, par_level = null,
      -- Prepped: never collected. Stock: from Dry storage unless Admin set somewhere else.
      location_id = case when t is not null then null else location_id end
      where id = pl;
    if t is not null then update products set default_location_id = null where id = p; end if;
  end loop;

  -- Stock already set to Dry storage (an earlier run of this script) moves to the Alcohol storeroom.
  if store is not null then
    update products q set default_location_id = store
      where q.department_id = dept and (q.default_location_id is null or q.default_location_id in (select id from storage_locations where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('drystorage', 'drystore')))
        and exists (select 1 from product_placements x where x.product_id = q.id and x.check_area_id in (salad, dessert) and x.prep_task_id is null);
    update product_placements x set location_id = null
      where x.check_area_id in (salad, dessert) and x.location_id in (select id from storage_locations where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('drystorage', 'drystore'));
  end if;

  raise notice 'Above salad bar: %', (select string_agg(q.name || case when x.prep_task_id is not null then ' (prep)' else '' end, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = salad);
  raise notice 'Dessert station: %', (select string_agg(q.name || case when x.prep_task_id is not null then ' (prep)' else '' end, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = dessert);
  raise notice '% new products; stock from %', added, coalesce((select name from storage_locations where id = store), 'no storeroom (Alcohol storeroom not found)');
end $$;
