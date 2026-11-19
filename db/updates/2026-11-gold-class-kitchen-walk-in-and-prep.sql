-- Gold Class Kitchen: the upstairs walk-in fridge by location, the sauces, and the morning prep
-- checklist. Safe to run more than once. Only touches Gold Class Kitchen.
-- Run AFTER db/migrations/017_morning_prep.sql and the earlier Gold Class Kitchen scripts
-- (defrost, upstairs-areas, defrost-pulls, freezers).
--
-- Walk in fridge (upstairs), as sections on its screen:
--   Cheeseboard tub      back wall, 2nd shelf from the bottom, the white tub: brie, cheddar, quince paste
--   Bottom cheese shelf  American sliced cheese, smoky mozzarella, portioned Napoli cheese
--   Prep tubs            right-hand rack, blue-lidded tubs: cut carrot, cucumber, celery and radish (Harvest Hommus)
--   Spare produce        the shelf under the prep tubs: whole carrots, cucumbers, celery, radishes
--   Dessert shelf        right-hand dessert shelf: the 9 desserts (the same products as on Defrost)
--   Sauces               the 10 sauces made or portioned in morning prep (shelf to be confirmed)
--
-- * Cut vegetables and the prep sauces are stock, made or portioned in morning prep: an amount
--   entered for them is shown on the Finish screen for the morning team, never put on the
--   downstairs collection list. Everything else is collected from the downstairs walk-in fridge
--   (desserts: the downstairs walk-in freezer, as on Defrost).
-- * Other walk-in items already set up (in Admin or by other scripts) are kept as they are.
-- * Green Goddess sauce is archived (off the stock and prep lists; history kept).
-- * Manual quantities for now. Units are best guesses: change them in Admin → Products.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  walk uuid; defrost uuid; fridge uuid; freezer uuid; cat uuid; sec uuid; p uuid; pl uuid; t uuid; i int; area uuid;
  norm text;
  -- section, sort, note for staff
  secs text[][] := array[
    ['Cheeseboard tub', '1', 'Back wall, second shelf from the bottom: the white cheeseboard tub.'],
    ['Bottom cheese shelf', '2', ''],
    ['Prep tubs', '3', 'Right-hand rack, blue-lidded tubs: cut vegetables for the Harvest Hommus. Cut in morning prep, from the spare produce underneath.'],
    ['Spare produce', '4', 'The shelf underneath the prep tubs: uncut produce for refilling the prep tubs.'],
    ['Dessert shelf', '5', 'Right-hand dessert shelf: defrosted desserts. Anything on Defrost tonight is already counted ("Already … for Defrost").'],
    ['Sauces', '6', 'Shelf to be confirmed. Made or portioned in morning prep: what you enter goes to the morning team.']
  ];
  -- prep checklist: group, task
  tasks text[][] := array[
    ['vegetables', 'Cut carrots for Harvest Hommus'],
    ['vegetables', 'Cut cucumber for Harvest Hommus'],
    ['vegetables', 'Cut celery for Harvest Hommus'],
    ['vegetables', 'Cut radish for Harvest Hommus'],
    ['proteins', 'Portion defrosted pulled beef'],
    ['sauces', 'Portion BBQ sauce'],
    ['sauces', 'Portion sweet chilli sauce'],
    ['sauces', 'Portion tomato sauce'],
    ['sauces', 'Make vodka sauce'],
    ['sauces', 'Make sriracha mayo'],
    ['sauces', 'Make burger sauce'],
    ['sauces', 'Make hollandaise dressing'],
    ['sauces', 'Make tartare'],
    ['sauces', 'Make maple aioli'],
    ['sauces', 'Make sesame mayo']
  ];
  -- section, product, unit (one), unit (more), storeroom ('f' downstairs walk-in fridge, 'z' downstairs walk-in freezer), made in prep (task), note
  items text[][] := array[
    ['Cheeseboard tub', 'Brie', 'pack', 'packs', 'f', '', ''],
    ['Cheeseboard tub', 'Cheddar', 'block', 'blocks', 'f', '', ''],
    ['Cheeseboard tub', 'Quince Paste', 'pack', 'packs', 'f', '', ''],
    ['Bottom cheese shelf', 'American Sliced Cheese', 'pack', 'packs', 'f', '', ''],
    ['Bottom cheese shelf', 'Smoky Mozzarella', 'pack', 'packs', 'f', '', ''],
    ['Bottom cheese shelf', 'Portioned Napoli Cheese', 'portion', 'portions', 'f', '', ''],
    ['Prep tubs', 'Cut Carrot', 'tub', 'tubs', 'f', 'Cut carrots for Harvest Hommus', ''],
    ['Prep tubs', 'Cut Cucumber', 'tub', 'tubs', 'f', 'Cut cucumber for Harvest Hommus', ''],
    ['Prep tubs', 'Cut Celery', 'tub', 'tubs', 'f', 'Cut celery for Harvest Hommus', ''],
    ['Prep tubs', 'Cut Radish', 'tub', 'tubs', 'f', 'Cut radish for Harvest Hommus', ''],
    ['Spare produce', 'Carrots', 'bag', 'bags', 'f', '', 'Uncut, for the cut carrot'],
    ['Spare produce', 'Cucumbers', 'cucumber', 'cucumbers', 'f', '', 'Uncut, for the cut cucumber'],
    ['Spare produce', 'Celery', 'bunch', 'bunches', 'f', '', 'Uncut, for the cut celery'],
    ['Spare produce', 'Radishes', 'bunch', 'bunches', 'f', '', 'Uncut, for the cut radish'],
    ['Dessert shelf', 'Basque Cheesecake', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Chocolate Mousse Cake', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Sour Cherry Gel', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Golden Crumb', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Passionfruit Sponge', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Raspberry Coulis', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Salted Caramel Sauce', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Brownie', 'portion', 'portions', 'z', '', ''],
    ['Dessert shelf', 'Sticky Date', 'portion', 'portions', 'z', '', ''],
    ['Sauces', 'BBQ Sauce', 'tub', 'tubs', 'f', 'Portion BBQ sauce', 'Portioned in morning prep'],
    ['Sauces', 'Sweet Chilli Sauce', 'tub', 'tubs', 'f', 'Portion sweet chilli sauce', 'Portioned in morning prep'],
    ['Sauces', 'Tomato Sauce', 'tub', 'tubs', 'f', 'Portion tomato sauce', 'Portioned in morning prep'],
    ['Sauces', 'Vodka Sauce', 'tub', 'tubs', 'f', 'Make vodka sauce', ''],
    ['Sauces', 'Sriracha Mayo', 'tub', 'tubs', 'f', 'Make sriracha mayo', ''],
    ['Sauces', 'Burger Sauce', 'tub', 'tubs', 'f', 'Make burger sauce', ''],
    ['Sauces', 'Hollandaise Dressing', 'tub', 'tubs', 'f', 'Make hollandaise dressing', ''],
    ['Sauces', 'Tartare', 'tub', 'tubs', 'f', 'Make tartare', ''],
    ['Sauces', 'Maple Aioli', 'tub', 'tubs', 'f', 'Make maple aioli', ''],
    ['Sauces', 'Sesame Mayo', 'tub', 'tubs', 'f', 'Make sesame mayo', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if to_regclass('public.prep_tasks') is null then raise exception 'Run db/migrations/017_morning_prep.sql first'; end if;
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  defrost := (select id from check_areas where department_id = dept and active and lower(name) = 'defrost' and parent_area_id is null limit 1);
  if walk is null then raise exception 'Run 2026-11-gold-class-kitchen-upstairs-areas.sql first (it adds the Walk in fridge)'; end if;
  fridge := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfridge%' order by sort_order limit 1);
  freezer := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfreezer%' order by sort_order limit 1);
  if fridge is null or freezer is null then raise exception 'The downstairs walk-in fridge and walk-in freezer storerooms must exist first'; end if;

  -- 1. The morning prep checklist (existing tasks keep their place; new ones go after them).
  for i in 1 .. array_length(tasks, 1) loop
    t := (select id from prep_tasks where department_id = dept and lower(name) = lower(tasks[i][2]));
    if t is null then
      insert into prep_tasks (department_id, grp, name, sort_order)
        values (dept, tasks[i][1], tasks[i][2], coalesce((select max(sort_order) from prep_tasks where department_id = dept), 0) + 1);
    else
      update prep_tasks set active = true, grp = tasks[i][1] where id = t;
    end if;
  end loop;
  update prep_tasks set active = false where department_id = dept and lower(name) like '%green goddess%';

  -- 2. Green Goddess sauce: off the stock lists.
  update products set status = 'archived' where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'greengoddess%';

  -- 3. The walk-in fridge sections.
  for i in 1 .. array_length(secs, 1) loop
    sec := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · ' || secs[i][1]) limit 1);
    if sec is null then
      insert into check_areas (department_id, name, sort_order) values (dept, 'Walk in fridge · ' || secs[i][1], secs[i][2]::int) returning id into sec;
    end if;
    update check_areas set active = true, parent_area_id = walk, section_mode = 'open', sort_order = secs[i][2]::int where id = sec;
    update check_areas set guide_text = secs[i][3] where id = sec and trim(coalesce(guide_text, '')) = '' and secs[i][3] <> '';
  end loop;
  update check_areas set guide_text = 'The upstairs walk-in fridge. Add only what needs topping up; prep tubs and sauces go to the morning team.'
    where id = walk and (trim(coalesce(guide_text, '')) = '' or guide_text = 'The upstairs walk-in fridge. Add only what needs topping up from the downstairs walk-in fridge.');

  insert into categories (department_id, name, sort_order) select dept, 'Walk-in fridge', 3
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'walk-in fridge');
  cat := (select id from categories where department_id = dept and lower(name) = 'walk-in fridge');

  -- 4. Every item in its place (reusing products by name, e.g. the desserts from Defrost).
  for i in 1 .. array_length(items, 1) loop
    area := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · ' || items[i][1]));
    norm := regexp_replace(lower(items[i][2]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, items[i][2], items[i][3], items[i][4], 'manual', case items[i][5] when 'z' then freezer else fridge end, 600 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat),
        default_location_id = coalesce(default_location_id, case items[i][5] when 'z' then freezer else fridge end) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      -- Already on the walk-in's own list: move it into its section.
      pl := (select id from product_placements where product_id = p and check_area_id = walk limit 1);
      if pl is not null then update product_placements set check_area_id = area where id = pl; end if;
    end if;
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl; end if;
    update product_placements set sort_order = i, par_level = null, heading = null,
      location_id = coalesce(location_id, case items[i][5] when 'z' then freezer else fridge end),
      instructions = coalesce(nullif(trim(instructions), ''), nullif(items[i][7], '')),
      prep_task_id = case when items[i][6] = '' then prep_task_id else (select id from prep_tasks where department_id = dept and lower(name) = lower(items[i][6])) end
      where id = pl;
  end loop;

  -- 5. Pulled beef pulled for Defrost is portioned by the morning team.
  if defrost is not null then
    update product_placements x set prep_task_id = (select id from prep_tasks where department_id = dept and lower(name) = 'portion defrosted pulled beef')
      from products q where q.id = x.product_id and x.check_area_id = defrost and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = 'pulledbeefbao';
  end if;

  raise notice 'Walk in fridge: % items in % sections; morning prep checklist: % tasks',
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.parent_area_id = walk or c.id = walk),
    (select count(*) from check_areas where parent_area_id = walk and active),
    (select count(*) from prep_tasks where department_id = dept and active);
end $$;
