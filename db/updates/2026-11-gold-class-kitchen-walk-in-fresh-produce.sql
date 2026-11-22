-- Gold Class Kitchen walk-in fridge: Fresh produce, and the left rack's pickles. Safe to run more than once.
-- Run AFTER the earlier Gold Class Kitchen walk-in fridge scripts. Only touches Gold Class Kitchen.
--
--   Fresh produce (was Spare produce)  Carrots, Cucumbers, Celery, Radishes, Tomatoes, Red Onion, White Onion
--                                     (the "Uncut, for the cut …" notes are removed)
--   Left rack lower shelves            Cornichons (was Sliced Pickles / Cucumbers), Pickled Ginger, Hellmann's Mayonnaise
--
-- * The section and the pickles product are renamed (same records: past restocks and Admin settings are kept).
-- * New products (Red Onion, White Onion, Pickled Ginger): "staff enter", with these units (change them in Admin if
--   needed) and no storeroom assumed (set it in Admin).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  walk uuid; fresh uuid; lrack uuid; area uuid; p uuid; pl uuid; i int; norm text; added int := 0;
  -- section, product, unit (one), unit (more)
  items text[][] := array[
    ['fresh', 'Red Onion', 'onion', 'onions'],
    ['fresh', 'White Onion', 'onion', 'onions'],
    ['left', 'Cornichons', 'jar', 'jars'],
    ['left', 'Pickled Ginger', 'jar', 'jars']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  if walk is null then raise exception 'Run the earlier Gold Class Kitchen walk-in fridge scripts first'; end if;

  -- 1. Spare produce → Fresh produce (the same section).
  fresh := (select id from check_areas where department_id = dept and parent_area_id = walk and lower(name) = lower('Walk in fridge · Fresh produce') limit 1);
  if fresh is null then
    fresh := (select id from check_areas where department_id = dept and parent_area_id = walk and lower(name) = lower('Walk in fridge · Spare produce') limit 1);
    if fresh is not null then update check_areas set name = 'Walk in fridge · Fresh produce' where id = fresh;
    else insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode) values (dept, 'Walk in fridge · Fresh produce', 7, walk, 'open') returning id into fresh; end if;
  end if;
  update check_areas set active = true,
    guide_text = case when trim(coalesce(guide_text, '')) = '' or guide_text like 'The shelf underneath the prep tubs: uncut produce%'
                      then 'The shelf underneath the prep tubs: fresh produce.' else guide_text end
    where id = fresh;
  -- No "Uncut, for the cut carrot" (etc.) notes.
  update product_placements set instructions = null where check_area_id = fresh and instructions ilike 'Uncut, for the cut %';
  -- The prep tubs' note says where the produce now is.
  update check_areas set guide_text = replace(guide_text, 'from the spare produce underneath', 'from the fresh produce underneath')
    where department_id = dept and parent_area_id = walk and guide_text like '%from the spare produce underneath%';

  -- 2. Left rack: Sliced Pickles / Cucumbers → Cornichons (the same product), unless Cornichons already exists.
  lrack := (select id from check_areas where department_id = dept and parent_area_id = walk and lower(name) = lower('Walk in fridge · Left rack lower shelves') limit 1);
  if lrack is null then
    insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode, guide_text) values (dept, 'Walk in fridge · Left rack lower shelves', 8, walk, 'open', 'Left rack, lower shelves.') returning id into lrack;
  end if;
  update check_areas set active = true where id = lrack;
  if not exists (select 1 from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'cornichons') then
    update products set name = 'Cornichons', unit_singular = 'jar', unit_plural = 'jars'
      where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('slicedpicklescucumbers', 'slicedpickles');
  end if;

  -- 3. The new items, after what's already on each shelf (Cornichons and Pickled Ginger first on the left rack).
  for i in 1 .. array_length(items, 1) loop
    area := case when items[i][1] = 'fresh' then fresh else lrack end;
    norm := regexp_replace(lower(items[i][2]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, items[i][2], items[i][3], items[i][4], 'manual', null, 900 + i) returning id into p;
      added := added + 1;
    else
      update products set status = 'active' where id = p and status <> 'active';
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and (c.id = walk or c.parent_area_id = walk) and x.prep_task_id is null order by x.sort_order limit 1);
      if pl is not null then update product_placements set check_area_id = area where id = pl; end if;
    end if;
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, 0) returning id into pl; end if;
    update product_placements set sort_order = case when area = fresh then 100 + i else i end where id = pl;
  end loop;
  -- Hellmann's after the pickles.
  update product_placements x set sort_order = 50 from products q where q.id = x.product_id and x.check_area_id = lrack and q.name ilike 'hellmann%';

  raise notice 'Fresh produce: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = fresh);
  raise notice 'Left rack lower shelves: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = lrack);
  raise notice '% new products', added;
end $$;
