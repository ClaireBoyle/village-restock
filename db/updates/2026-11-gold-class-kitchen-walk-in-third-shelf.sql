-- Gold Class Kitchen walk-in fridge: the third and fourth shelves (back wall). Safe to run more than once.
-- Run AFTER the earlier Gold Class Kitchen scripts. Only touches Gold Class Kitchen.
--
--   Third shelf    Spare sauce ingredients: Maple Syrup, Sauerkraut, Sesame Kewpie
--                  Feta and cheeseboard: Feta, Brie, Cheddar, Quince Paste, Strawberries, Raspberries
--   Fourth shelf   Mexican Rice, American Sliced Cheese, Smoky Mozzarella, Portioned Napoli Cheese (pizza cheese)
--   Right rack top shelf   the burger buns (as before), then Fresh herbs: Mint, Parsley, Spring Onion
--
-- * "Cheeseboard tub" becomes "Third shelf" and "Bottom cheese shelf" becomes "Fourth shelf" (the same records,
--   so past restocks and anything set in Admin are kept). Existing products and rows are reused and moved,
--   never duplicated; notes changed in Admin are kept.
-- * New products (Maple Syrup, Sauerkraut, Sesame Kewpie, Feta, Raspberries, Mexican Rice, Mint, Parsley,
--   Spring Onion): "staff enter", with
--   these units (change them in Admin if needed) and no storeroom assumed (set it in Admin; until then they're
--   listed under "No storeroom set" on the collection list).
-- * 2026-11-gold-class-kitchen-walk-in-shelves.sql does nothing once this has run, so the old shelves never come back.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  walk uuid; third uuid; fourth uuid; herbs uuid; area uuid; p uuid; pl uuid; i int; norm text; moved int := 0; added int := 0;
  -- section, product, unit (one), unit (more), subheading ('' = none), note
  items text[][] := array[
    ['Third shelf', 'Maple Syrup', 'bottle', 'bottles', 'Spare sauce ingredients', ''],
    ['Third shelf', 'Sauerkraut', 'tub', 'tubs', '', ''],
    ['Third shelf', 'Sesame Kewpie', 'bottle', 'bottles', '', ''],
    ['Third shelf', 'Feta', 'tub', 'tubs', 'Feta and cheeseboard', ''],
    ['Third shelf', 'Brie', 'pack', 'packs', '', ''],
    ['Third shelf', 'Cheddar', 'block', 'blocks', '', ''],
    ['Third shelf', 'Quince Paste', 'pack', 'packs', '', ''],
    ['Third shelf', 'Strawberries', 'punnet', 'punnets', '', 'Beside the cheeseboard tub'],
    ['Third shelf', 'Raspberries', 'punnet', 'punnets', '', 'Beside the strawberries'],
    ['Fourth shelf', 'Mexican Rice', 'tub', 'tubs', '', ''],
    ['Fourth shelf', 'American Sliced Cheese', 'pack', 'packs', '', ''],
    ['Fourth shelf', 'Smoky Mozzarella', 'pack', 'packs', '', ''],
    ['Fourth shelf', 'Portioned Napoli Cheese', 'portion', 'portions', '', 'Pizza cheese'],
    ['Right rack top shelf', 'Mint', 'bunch', 'bunches', 'Fresh herbs', ''],
    ['Right rack top shelf', 'Parsley', 'bunch', 'bunches', '', ''],
    ['Right rack top shelf', 'Spring Onion', 'bunch', 'bunches', '', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  if walk is null then raise exception 'Run the earlier Gold Class Kitchen walk-in fridge scripts first'; end if;

  -- 1. The two shelves: renamed from the cheeseboard tub and bottom cheese shelf (or made, if those aren't there).
  third := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · Third shelf') limit 1);
  if third is null then
    third := (select id from check_areas where department_id = dept and parent_area_id = walk and lower(name) = lower('Walk in fridge · Cheeseboard tub') limit 1);
    if third is not null then update check_areas set name = 'Walk in fridge · Third shelf' where id = third;
    else insert into check_areas (department_id, name, sort_order) values (dept, 'Walk in fridge · Third shelf', 3) returning id into third; end if;
  end if;
  fourth := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · Fourth shelf') limit 1);
  if fourth is null then
    fourth := (select id from check_areas where department_id = dept and parent_area_id = walk and lower(name) = lower('Walk in fridge · Bottom cheese shelf') limit 1);
    if fourth is not null then update check_areas set name = 'Walk in fridge · Fourth shelf' where id = fourth;
    else insert into check_areas (department_id, name, sort_order) values (dept, 'Walk in fridge · Fourth shelf', 4) returning id into fourth; end if;
  end if;
  update check_areas set active = true, parent_area_id = walk, section_mode = 'open', sort_order = 3,
    guide_text = case when trim(coalesce(guide_text, '')) = '' or guide_text like 'Back wall, second shelf from the bottom:%'
                      then 'Back wall, third shelf: spare sauce ingredients, then the feta and cheeseboard (brie, cheddar, quince paste) with the strawberries and raspberries.'
                      else guide_text end
    where id = third;
  update check_areas set active = true, parent_area_id = walk, section_mode = 'open', sort_order = 4,
    guide_text = case when trim(coalesce(guide_text, '')) = '' or guide_text = 'Back wall, bottom cheese shelf.'
                      then 'Back wall, the shelf below: Mexican rice, then the sliced, smoked and pizza cheeses.'
                      else guide_text end
    where id = fourth;

  -- The right rack's top shelf: burger buns first (as they are), then the fresh herbs.
  herbs := (select id from check_areas where department_id = dept and parent_area_id = walk and lower(name) = lower('Walk in fridge · Right rack top shelf') limit 1);
  if herbs is null then
    insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode) values (dept, 'Walk in fridge · Right rack top shelf', 5, walk, 'open') returning id into herbs;
  end if;
  update check_areas set active = true,
    guide_text = case when trim(coalesce(guide_text, '')) in ('', 'Right rack, top shelf.') then 'Right rack, top shelf: burger buns, then the fresh herbs.' else guide_text end
    where id = herbs;

  -- 2. Every item on its shelf, in order, moving rows that are elsewhere in the walk-in (never copying them).
  for i in 1 .. array_length(items, 1) loop
    area := case items[i][1] when 'Third shelf' then third when 'Fourth shelf' then fourth else herbs end;
    norm := regexp_replace(lower(items[i][2]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, items[i][2], items[i][3], items[i][4], 'manual', null, 800 + i) returning id into p;
      added := added + 1;
    else
      update products set status = 'active' where id = p and status <> 'active';
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and (c.id = walk or c.parent_area_id = walk) and x.prep_task_id is null order by x.sort_order limit 1);
      if pl is not null then update product_placements set check_area_id = area where id = pl; moved := moved + 1; end if;
    end if;
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl; end if;
    update product_placements set sort_order = case when area = herbs then 100 + i else i end, heading = nullif(items[i][5], ''),
      instructions = coalesce(nullif(trim(instructions), ''), nullif(items[i][6], ''))
      where id = pl;
  end loop;

  raise notice 'Third shelf: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = third);
  raise notice 'Fourth shelf: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = fourth);
  raise notice 'Right rack top shelf: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = herbs);
  raise notice '% new products, % rows moved', added, moved;
end $$;
