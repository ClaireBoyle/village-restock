-- Gold Class Kitchen: the upstairs walk-in fridge's confirmed shelves, and corrections. Safe to run more
-- than once. Run AFTER 2026-11-gold-class-kitchen-walk-in-and-prep.sql. Only touches Gold Class Kitchen.
--
--   Top sauce shelf        back wall, top: tomato, garlic sauce / aioli, tzatziki, chipotle, vegan aioli,
--                          hollandaise dressing, sriracha, buttermilk ranch
--   Second sauce shelf     back wall: sweet chilli, burger sauce, XO sauce, sesame mayo, sriracha mayo,
--                          tartare, BBQ; soy sauce at the far right
--   Cheeseboard tub        back wall, 2nd shelf from the bottom, the white tub: brie, cheddar, quince paste;
--                          strawberries beside it
--   Bottom cheese shelf    back wall: American sliced cheese, smoky mozzarella, portioned Napoli cheese
--   Right rack, top shelf  burger buns in tubs (the same "Buns (Portioned Tubs)" as Defrost and Freezer 1)
--   Prep tubs              right rack, blue-lidded: cut carrot, cucumber, celery, radish (Harvest Hommus)
--   Spare produce          under the prep tubs: uncut produce for prep, including tomatoes
--   Left rack, lower       sliced pickles / cucumbers, Hellmann's mayonnaise
--   Dessert shelf          right-hand: the 9 desserts (collected frozen from the downstairs walk-in freezer)
--   Sauces, shelf to confirm  vodka sauce, maple aioli
--
-- Corrections:
-- * Sauces made or portioned in morning prep (BBQ, sweet chilli, tomato, vodka sauce, sriracha mayo,
--   burger sauce, hollandaise dressing, tartare, maple aioli, sesame mayo) have no collection source:
--   the assumed downstairs walk-in fridge is removed. An amount entered for one adds its prep task.
--   (The cut vegetables, also made in prep, lose it too: they're cut from the spare produce.)
-- * Other sauces are bottles, counted in bottles. Their storeroom, and that of the other new items,
--   is left for you to set in Admin (they show under "No storeroom set" if collected before then).
-- * Green Goddess is off the lists. No pars, conversions or salad/herb varieties are assumed.
-- * Existing products and their rows are reused and moved (never duplicated); notes changed in Admin are kept.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  walk uuid; area uuid; sec uuid; p uuid; pl uuid; i int; norm text;
  -- section, sort, note for staff ('' = keep what's there)
  secs text[][] := array[
    ['Top sauce shelf', '1', 'Back wall, top sauce shelf.'],
    ['Second sauce shelf', '2', 'Back wall, second sauce shelf. Soy sauce is at the far right.'],
    ['Cheeseboard tub', '3', 'Back wall, second shelf from the bottom: the white cheeseboard tub, with the strawberries beside it.'],
    ['Bottom cheese shelf', '4', 'Back wall, bottom cheese shelf.'],
    ['Right rack top shelf', '5', 'Right rack, top shelf.'],
    ['Prep tubs', '6', ''],
    ['Spare produce', '7', 'The shelf underneath the prep tubs: uncut produce for prep, including tomatoes.'],
    ['Left rack lower shelves', '8', 'Left rack, lower shelves.'],
    ['Dessert shelf', '9', ''],
    ['Sauces (shelf to confirm)', '10', 'Exact shelf to be confirmed. Made in morning prep: what you enter goes to the morning team.']
  ];
  -- section, product, unit (one), unit (more), kind ('prep' made in morning prep · 'bottle' · 'new' · 'keep'), note
  items text[][] := array[
    ['Top sauce shelf', 'Tomato Sauce', 'tub', 'tubs', 'prep', ''],
    ['Top sauce shelf', 'Garlic Sauce / Aioli', 'bottle', 'bottles', 'bottle', ''],
    ['Top sauce shelf', 'Tzatziki', 'bottle', 'bottles', 'bottle', ''],
    ['Top sauce shelf', 'Chipotle', 'bottle', 'bottles', 'bottle', ''],
    ['Top sauce shelf', 'Vegan Aioli', 'bottle', 'bottles', 'bottle', ''],
    ['Top sauce shelf', 'Hollandaise Dressing', 'tub', 'tubs', 'prep', ''],
    ['Top sauce shelf', 'Sriracha', 'bottle', 'bottles', 'bottle', ''],
    ['Top sauce shelf', 'Buttermilk Ranch', 'bottle', 'bottles', 'bottle', ''],
    ['Second sauce shelf', 'Sweet Chilli Sauce', 'tub', 'tubs', 'prep', ''],
    ['Second sauce shelf', 'Burger Sauce', 'tub', 'tubs', 'prep', ''],
    ['Second sauce shelf', 'XO Sauce', 'bottle', 'bottles', 'bottle', ''],
    ['Second sauce shelf', 'Sesame Mayo', 'tub', 'tubs', 'prep', ''],
    ['Second sauce shelf', 'Sriracha Mayo', 'tub', 'tubs', 'prep', ''],
    ['Second sauce shelf', 'Tartare', 'tub', 'tubs', 'prep', ''],
    ['Second sauce shelf', 'BBQ Sauce', 'tub', 'tubs', 'prep', ''],
    ['Second sauce shelf', 'Soy Sauce', 'bottle', 'bottles', 'bottle', 'Far right of the shelf'],
    ['Cheeseboard tub', 'Brie', 'pack', 'packs', 'keep', ''],
    ['Cheeseboard tub', 'Cheddar', 'block', 'blocks', 'keep', ''],
    ['Cheeseboard tub', 'Quince Paste', 'pack', 'packs', 'keep', ''],
    ['Cheeseboard tub', 'Strawberries', 'punnet', 'punnets', 'new', 'Beside the cheeseboard tub'],
    ['Bottom cheese shelf', 'American Sliced Cheese', 'pack', 'packs', 'keep', ''],
    ['Bottom cheese shelf', 'Smoky Mozzarella', 'pack', 'packs', 'keep', ''],
    ['Bottom cheese shelf', 'Portioned Napoli Cheese', 'portion', 'portions', 'keep', ''],
    ['Right rack top shelf', 'Buns (Portioned Tubs)', 'tub', 'tubs', 'keep', 'Burger buns, in tubs'],
    ['Prep tubs', 'Cut Carrot', 'tub', 'tubs', 'prep', ''],
    ['Prep tubs', 'Cut Cucumber', 'tub', 'tubs', 'prep', ''],
    ['Prep tubs', 'Cut Celery', 'tub', 'tubs', 'prep', ''],
    ['Prep tubs', 'Cut Radish', 'tub', 'tubs', 'prep', ''],
    ['Spare produce', 'Carrots', 'bag', 'bags', 'keep', ''],
    ['Spare produce', 'Cucumbers', 'cucumber', 'cucumbers', 'keep', ''],
    ['Spare produce', 'Celery', 'bunch', 'bunches', 'keep', ''],
    ['Spare produce', 'Radishes', 'bunch', 'bunches', 'keep', ''],
    ['Spare produce', 'Tomatoes', 'tomato', 'tomatoes', 'new', ''],
    ['Left rack lower shelves', 'Sliced Pickles / Cucumbers', 'jar', 'jars', 'new', ''],
    ['Left rack lower shelves', 'Hellmann''s Mayonnaise', 'jar', 'jars', 'new', ''],
    ['Dessert shelf', 'Basque Cheesecake', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Chocolate Mousse Cake', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Sour Cherry Gel', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Golden Crumb', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Passionfruit Sponge', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Raspberry Coulis', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Salted Caramel Sauce', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Brownie', 'portion', 'portions', 'keep', ''],
    ['Dessert shelf', 'Sticky Date', 'portion', 'portions', 'keep', ''],
    ['Sauces (shelf to confirm)', 'Vodka Sauce', 'tub', 'tubs', 'prep', ''],
    ['Sauces (shelf to confirm)', 'Maple Aioli', 'tub', 'tubs', 'prep', '']
  ];
  -- product → its morning prep task
  links text[][] := array[
    ['Tomato Sauce', 'Portion tomato sauce'], ['Sweet Chilli Sauce', 'Portion sweet chilli sauce'], ['BBQ Sauce', 'Portion BBQ sauce'],
    ['Vodka Sauce', 'Make vodka sauce'], ['Sriracha Mayo', 'Make sriracha mayo'], ['Burger Sauce', 'Make burger sauce'],
    ['Hollandaise Dressing', 'Make hollandaise dressing'], ['Tartare', 'Make tartare'], ['Maple Aioli', 'Make maple aioli'],
    ['Sesame Mayo', 'Make sesame mayo'], ['Cut Carrot', 'Cut carrots for Harvest Hommus'], ['Cut Cucumber', 'Cut cucumber for Harvest Hommus'],
    ['Cut Celery', 'Cut celery for Harvest Hommus'], ['Cut Radish', 'Cut radish for Harvest Hommus']
  ];
  freezer uuid; fridge uuid; task uuid; kind text;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if to_regclass('public.prep_tasks') is null then raise exception 'Run db/migrations/017_morning_prep.sql first'; end if;
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  if walk is null then raise exception 'Run 2026-11-gold-class-kitchen-upstairs-areas.sql and -walk-in-and-prep.sql first'; end if;
  freezer := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfreezer%' order by sort_order limit 1);
  fridge := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfridge%' order by sort_order limit 1);

  -- 1. Sections. The old "Sauces" section becomes "Sauces (shelf to confirm)" (same record).
  update check_areas set name = 'Walk in fridge · Sauces (shelf to confirm)', guide_text = ''
    where department_id = dept and lower(name) = lower('Walk in fridge · Sauces')
      and not exists (select 1 from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · Sauces (shelf to confirm)'));
  for i in 1 .. array_length(secs, 1) loop
    sec := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · ' || secs[i][1]) limit 1);
    if sec is null then
      insert into check_areas (department_id, name, sort_order) values (dept, 'Walk in fridge · ' || secs[i][1], secs[i][2]::int) returning id into sec;
    end if;
    update check_areas set active = true, parent_area_id = walk, section_mode = 'open', sort_order = secs[i][2]::int where id = sec;
    -- The shelf directions: blank ones, and the earlier wording, are replaced.
    update check_areas set guide_text = secs[i][3] where id = sec and secs[i][3] <> ''
      and (trim(coalesce(guide_text, '')) = '' or guide_text like 'Back wall, second shelf from the bottom: the white cheeseboard tub.%'
           or guide_text like 'The shelf underneath the prep tubs:%' or guide_text like 'Shelf to be confirmed.%');
  end loop;

  -- 2. Every item on its shelf, moving rows that are elsewhere in the walk-in (never copying them).
  for i in 1 .. array_length(items, 1) loop
    area := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · ' || items[i][1]));
    kind := items[i][5];
    norm := regexp_replace(lower(items[i][2]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      -- New: no storeroom assumed (set it in Admin). Desserts and buns are never new here.
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, items[i][2], items[i][3], items[i][4], 'manual', null, 700 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual' where id = p;
    end if;
    -- Bottled sauces are counted in bottles.
    if kind = 'bottle' then update products set unit_singular = 'bottle', unit_plural = 'bottles' where id = p; end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and (c.id = walk or c.parent_area_id = walk) order by x.sort_order limit 1);
      if pl is not null then update product_placements set check_area_id = area where id = pl; end if;
    end if;
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl; end if;
    update product_placements set sort_order = i, par_level = null, heading = null,
      instructions = coalesce(nullif(trim(instructions), ''), nullif(items[i][6], ''))
      where id = pl;
    -- Made in morning prep: no collection source (it's prepared, never collected).
    if kind = 'prep' then
      update product_placements set location_id = null where id = pl;
      update products set default_location_id = null where id = p and (default_location_id is null or default_location_id = fridge);
    end if;
  end loop;

  -- 3. Each prep-made product is linked to its morning prep task.
  for i in 1 .. array_length(links, 1) loop
    task := (select id from prep_tasks where department_id = dept and lower(name) = lower(links[i][2]));
    if task is null then continue; end if;
    update product_placements x set prep_task_id = task
      from products q, check_areas c where q.id = x.product_id and c.id = x.check_area_id and (c.id = walk or c.parent_area_id = walk)
        and q.department_id = dept and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(links[i][1]), '[^a-z0-9]', '', 'g');
  end loop;

  -- 4. Desserts: collected frozen from the downstairs walk-in freezer.
  if freezer is not null then
    update product_placements x set location_id = freezer from products q, check_areas c
      where q.id = x.product_id and c.id = x.check_area_id and lower(c.name) = lower('Walk in fridge · Dessert shelf') and q.department_id = dept;
  end if;

  -- 5. Green Goddess is no longer on the menu.
  update products set status = 'archived' where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'greengoddess%';
  update prep_tasks set active = false where department_id = dept and lower(name) like '%green goddess%';

  raise notice 'Walk in fridge: % items on % shelves (% made in morning prep, % bottled sauces)',
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.parent_area_id = walk or c.id = walk),
    (select count(*) from check_areas where parent_area_id = walk and active),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where (c.parent_area_id = walk or c.id = walk) and x.prep_task_id is not null),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id join products q on q.id = x.product_id
       where (c.parent_area_id = walk or c.id = walk) and q.unit_plural = 'bottles');
end $$;

-- Desserts are on Defrost only now (…-no-walk-in-desserts.sql): running this again never brings the walk-in dessert shelf back.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  shelf uuid := (select c.id from check_areas c where c.department_id = dept and lower(c.name) = lower('Walk in fridge · Dessert shelf') limit 1);
begin
  if shelf is not null then
    delete from product_placements where check_area_id = shelf;
    update check_areas set active = false where id = shelf;
  end if;
end $$;
