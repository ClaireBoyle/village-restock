-- Gold Class Kitchen walk-in fridge: the bottom (lower left) sauce shelf, unportioned sauces and sauce ingredients.
-- Safe to run more than once. Run AFTER the earlier Gold Class Kitchen walk-in fridge scripts. Only touches Gold Class Kitchen.
--
--   Spare bottles, keep 2 of each:  Sweet Chilli Sauce (unportioned), Tomato Sauce (unportioned),
--                              Smokey BBQ Sauce (unportioned), Hellmann's Mayo (bottle)
--   Keep 1 of each:            Lemon Juice, Dijon Mayo, Gherkin Relish
--   Then what's already there (e.g. vodka sauce, made in morning prep; the relish's spare tub).
--
-- * The shelf is the walk-in's lower spare sauces section (whatever it's called now, e.g. "Spare Sauces(lower left
--   shelf)"); its name is kept, its note says what's on it.
-- * These are their own products, separate from the portioned sauces on the upper shelves (made in morning prep).
--   Like the rest of the Kitchen, staff only Add what's needed: the subheadings say how many to keep, so
--   nothing has to be counted and finishing is never held up. No storeroom assumed (set it in Admin; until then
--   "No storeroom set" on the collection list).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  walk uuid; shelf uuid; p uuid; pl uuid; i int; norm text; added int := 0;
  -- product, unit (one), unit (more), target, subheading
  items text[][] := array[
    ['Sweet Chilli Sauce (unportioned)', 'bottle', 'bottles', '2', 'Spare bottles · keep 2 of each'],
    ['Tomato Sauce (unportioned)', 'bottle', 'bottles', '2', ''],
    ['Smokey BBQ Sauce (unportioned)', 'bottle', 'bottles', '2', ''],
    ['Hellmann''s Mayo (bottle)', 'bottle', 'bottles', '2', ''],
    ['Lemon Juice', 'bottle', 'bottles', '1', 'Ingredients · keep 1 of each'],
    ['Dijon Mayo', 'bottle', 'bottles', '1', ''],
    ['Gherkin Relish', 'jar', 'jars', '1', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  if walk is null then raise exception 'Run the earlier Gold Class Kitchen walk-in fridge scripts first'; end if;

  -- The lower spare sauces shelf, as it's called now.
  shelf := (select id from check_areas where department_id = dept and parent_area_id = walk and active
            and (name ilike 'Walk in fridge · %spare sauces%' or name ilike 'Walk in fridge · Sauces (shelf to confirm)%' or name ilike 'Walk in fridge · Bottom sauce shelf%')
            order by sort_order desc limit 1);
  if shelf is null then
    insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode) values (dept, 'Walk in fridge · Bottom sauce shelf', 10, walk, 'open') returning id into shelf;
  end if;
  update check_areas set guide_text = 'Bottom sauce shelf: unportioned sauces and sauce ingredients. Add what''s needed to keep the spares topped up. Vodka sauce is made in morning prep (Add prep).'
    where id = shelf and (trim(coalesce(guide_text, '')) = '' or guide_text like '%Made in morning prep: what you enter goes to the morning team.' or guide_text like 'Spare sauce tubs.%');

  for i in 1 .. array_length(items, 1) loop
    norm := regexp_replace(lower(items[i][1]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, items[i][1], items[i][2], items[i][3], 'manual', null, 950 + i) returning id into p;
      added := added + 1;
    else
      update products set status = 'active' where id = p and status <> 'active';
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = shelf limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, shelf, i) returning id into pl; end if;
    -- First on the shelf, in this order; how many to keep is in the subheading ("keep 2 of each").
    update product_placements set sort_order = i, heading = nullif(items[i][5], ''), par_level = null, prep_task_id = null,
      instructions = case when instructions like 'Keep % bottle%' or instructions like 'Keep % jar%' then null else instructions end
      where id = pl;
  end loop;
  -- What was already on the shelf comes after.
  update product_placements x set sort_order = 100 + x.sort_order
    where x.check_area_id = shelf and x.sort_order < 100
      and x.product_id not in (select q.id from products q where q.department_id = dept
        and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = any(array(select regexp_replace(lower(items[j][1]), '[^a-z0-9]', '', 'g') from generate_subscripts(items, 1) j)));

  raise notice '%: %', (select replace(name, 'Walk in fridge · ', '') from check_areas where id = shelf),
    (select string_agg(q.name || coalesce(' (' || x.instructions || ')', ''), ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = shelf);
  raise notice '% new products', added;
end $$;
