-- Gold Class Bar: Refill FOH from upstairs, then top up upstairs from downstairs. Safe to run more than once.
-- Run AFTER db/migrations/012_foh_pickups.sql. Only touches Gold Class Bar.
--
-- A full restock becomes: Check FOH → Refill FOH → Check BOH → Collect (downstairs) → Finish.
--
-- 1. New "FOH beer fridge" (before the FOH freezer), single bottles / cans:
--      Beer, Cider & Hard Soda: the 12 beers           grabbed from the BOH bar fridge
--      Mixers & Water:          Kirks Dry Ginger Ale, Kirks Indian Tonic Water,
--                               Mount Franklin Sparkling Water 330ml  grabbed from the BOH bar fridge
--                               Mount Franklin Still Water            grabbed from the slab in the Walk in fridge
--      Curatif Cocktails:       7 flavours               straight from the Alcohol storeroom
-- 2. Back bench / Back shelves: red wine and spirits are grabbed from the upstairs Wine / Spirits
--    cupboard (wherever the cupboard holds the same product). Syrups still come from downstairs.
-- 3. Suggested for the upstairs spot it came from (keep, change or remove on Check BOH):
--    red wine, spirits and Sparkling Water 330ml. NOT suggested: beers and Kirks (the BOH fridge is
--    counted in packs), Still Water (a new slab only when under ¼ is left), sugar and flake.
-- 4. BOH bar fridge: Kirks counted in packs. Walk in fridge: Still Water counted in slabs.
-- 5. Sugar and Cadbury Flake containers: a "refill to the top" task each, from the upstairs cupboard.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  alc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  dry uuid := (select id from storage_locations where lower(name) = 'dry storage');
  bohf uuid; walkin uuid; ups uuid; beerf uuid; freezer uuid; bench uuid; shelves uuid;
  cat uuid; p uuid; pl uuid; i int; s int; n int;
  -- name, unit (one), unit (more), heading, pickup ('f' BOH bar fridge, 'w' Walk in fridge, '' downstairs), suggest ('y')
  list text[][] := array[
    ['Heineken Zero', 'bottle', 'bottles', 'Beer, Cider & Hard Soda', 'f', ''],
    ['James Squire Ginger Beer', 'bottle', 'bottles', '', 'f', ''],
    ['Little Creatures Rogers', 'bottle', 'bottles', '', 'f', ''],
    ['Hahn Superdry 3.5', 'bottle', 'bottles', '', 'f', ''],
    ['Guinness', 'bottle', 'bottles', '', 'f', ''],
    ['Stone & Wood Pacific Ale', 'bottle', 'bottles', '', 'f', ''],
    ['Little Creatures Pipsqueak Cider', 'bottle', 'bottles', '', 'f', ''],
    ['Furphy', 'bottle', 'bottles', '', 'f', ''],
    ['Kirin Ichiban', 'bottle', 'bottles', '', 'f', ''],
    ['Heineken', 'bottle', 'bottles', '', 'f', ''],
    ['James Boags Premium', 'bottle', 'bottles', '', 'f', ''],
    ['Suntory -196 Lemon', 'can', 'cans', '', 'f', ''],
    ['Kirks Dry Ginger Ale', 'bottle', 'bottles', 'Mixers & Water', 'f', ''],
    ['Kirks Indian Tonic Water', 'bottle', 'bottles', '', 'f', ''],
    ['Mount Franklin Sparkling Water 330ml', 'bottle', 'bottles', '', 'f', 'y'],
    ['Mount Franklin Still Water', 'bottle', 'bottles', '', 'w', ''],
    ['Curatif Negroni', 'can', 'cans', 'Curatif Cocktails', '', ''],
    ['Curatif Limoncello Sour', 'can', 'cans', '', '', ''],
    ['Curatif Pina Colada', 'can', 'cans', '', '', ''],
    ['Curatif Long Island', 'can', 'cans', '', '', ''],
    ['Curatif Shark Bite', 'can', 'cans', '', '', ''],
    ['Curatif Moviestar Martini', 'can', 'cans', '', '', ''],
    ['Curatif Amaretto Sour', 'can', 'cans', '', '', '']
  ];
  r record;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if alc is null then raise exception 'The storeroom "Alcohol storeroom" must exist first'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'pickup_area_id') then
    raise exception 'Run db/migrations/012_foh_pickups.sql first';
  end if;
  bohf := (select id from check_areas where department_id = dept and active and lower(name) = 'boh bar fridge' limit 1);
  walkin := (select id from check_areas where department_id = dept and active and lower(name) like 'walk in fridge%' and parent_area_id is null order by sort_order limit 1);
  ups := (select id from check_areas where department_id = dept and active and lower(name) = 'upstairs cupboards' limit 1);
  bench := (select id from check_areas where department_id = dept and active and lower(name) = 'back bench' limit 1);
  shelves := (select id from check_areas where department_id = dept and active and lower(name) = 'back shelves' limit 1);
  freezer := (select id from check_areas where department_id = dept and active and lower(name) = 'foh freezer' limit 1);
  if bohf is null or walkin is null or ups is null then
    raise exception 'Gold Class Bar needs its "BOH bar fridge", "Walk in fridge" and "Upstairs cupboards" areas first';
  end if;

  -- 1. The FOH beer fridge, just before the FOH freezer (or at the end).
  beerf := (select id from check_areas where department_id = dept and lower(name) = 'foh beer fridge' order by active desc limit 1);
  if beerf is null then
    s := coalesce((select sort_order from check_areas where id = freezer), (select max(sort_order) + 1 from check_areas where department_id = dept), 1);
    update check_areas set sort_order = sort_order + 1 where department_id = dept and sort_order >= s;
    insert into check_areas (department_id, name, sort_order) values (dept, 'FOH beer fridge', s) returning id into beerf;
  end if;
  -- (kept inside the Back bench stop if 2026-11-gold-class-bar-bench-fridge-stop.sql has put it there)
  update check_areas set active = true where id = beerf;
  update check_areas set guide_text = 'Enter the single bottles needed. They come from the BOH bar fridge and the walk-in; Curatif cocktails come from the Alcohol storeroom.'
    where id = beerf and trim(coalesce(guide_text, '')) = '';

  insert into categories (department_id, name, sort_order) select dept, 'Cocktails', 100
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'cocktails');
  cat := (select id from categories where department_id = dept and lower(name) = 'cocktails');
  for i in 1 .. array_length(list, 1) loop
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      if list[i][5] <> '' then raise exception 'Product "%" should already be in the BOH bar fridge or walk-in', list[i][1]; end if;
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][1], list[i][2], list[i][3], 'manual', alc, 950 + i) returning id into p;
    else
      update products set status = 'active' where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = beerf limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, beerf, i) returning id into pl; end if;
    update product_placements set sort_order = i, par_level = null, location_id = null, heading = nullif(list[i][4], ''),
      pickup_area_id = case list[i][5] when 'f' then bohf when 'w' then walkin else null end,
      pickup_suggest = list[i][6] = 'y',
      -- singles here; the product's own unit (e.g. packs) stays for the BOH fridge
      unit_singular = case when (select unit_plural from products where id = p) = list[i][3] then null else list[i][2] end,
      unit_plural = case when (select unit_plural from products where id = p) = list[i][3] then null else list[i][3] end
      where id = pl;
  end loop;

  -- 2 + 3. Back bench and Back shelves: grabbed from the upstairs cupboard that holds the same product.
  for r in
    select pl.id, (select c.id from check_areas c join product_placements x on x.check_area_id = c.id and x.product_id = pl.product_id
                   where c.parent_area_id = ups and c.active order by c.sort_order limit 1) as cupboard
    from product_placements pl where pl.check_area_id in (bench, shelves)
  loop
    update product_placements set pickup_area_id = r.cupboard, pickup_suggest = r.cupboard is not null where id = r.id;
  end loop;

  -- 4. Units upstairs: Kirks in packs in the BOH bar fridge; Still Water in slabs in the walk-in.
  update product_placements pl set unit_singular = 'pack', unit_plural = 'packs'
    from products p where p.id = pl.product_id and pl.check_area_id = bohf and lower(p.name) in ('kirks dry ginger ale', 'kirks indian tonic water');
  update product_placements pl set unit_singular = 'slab', unit_plural = 'slabs',
      instructions = 'Add a slab only when less than ¼ of the slab is left.'
    from products p where p.id = pl.product_id and pl.check_area_id = walkin and lower(p.name) = 'mount franklin still water';

  -- 5. Sugar and Cadbury Flake: refill the container to the top from the upstairs cupboard.
  if bench is not null then
    n := coalesce((select max(sort_order) from product_placements where check_area_id = bench), 0);
    for r in select * from (values
        ('Sugar container', 'Take the sugar container (next to the coffee machine) to the upstairs cupboard and fill it to the top.', 'Containers'),
        ('Cadbury Flake container', 'Take the flake container (near the milkshake machine) to the upstairs cupboard and fill it to the top.', null)) v(name, how, head)
    loop
      p := (select id from products where department_id = dept and lower(name) = lower(r.name) order by (status = 'active') desc, created_at limit 1);
      if p is null then
        insert into products (department_id, name, unit_singular, unit_plural, method, instructions, default_location_id, sort_order)
          values (dept, r.name, 'container', 'containers', 'routine', r.how, coalesce(dry, alc), 990) returning id into p;
      else
        update products set status = 'active', method = 'routine', instructions = r.how where id = p;
      end if;
      pl := (select id from product_placements where product_id = p and check_area_id = bench limit 1);
      -- Already moved by a later script (Coffee machine, Milkshake station): leave it there.
      if pl is null and exists (select 1 from product_placements where product_id = p and check_area_id <> bench) then
        update product_placements set pickup_area_id = ups, pickup_suggest = false where product_id = p and pickup_area_id is null;
        continue;
      end if;
      if pl is null then
        n := n + 1;
        insert into product_placements (product_id, check_area_id, sort_order) values (p, bench, n) returning id into pl;
      end if;
      update product_placements set heading = r.head, par_level = null, pickup_area_id = ups, pickup_suggest = false where id = pl;
    end loop;
  end if;

  -- Short reminders (only where they're still the old wording, or empty).
  update check_areas set guide_text = 'Grab from the upstairs cupboards. What you take is suggested for the cupboard on Check BOH.'
    where id in (bench, shelves) and (trim(coalesce(guide_text, '')) = '' or guide_text like 'Use the upstairs cupboards first%');
  update check_areas set guide_text = 'What you took for the back bar is already suggested. Keep it, change it or remove it, and add anything else that looks low.'
    where id = ups and (trim(coalesce(guide_text, '')) = '' or guide_text like 'Add only extra stock%');
  update check_areas set guide_text = 'Packs from downstairs: add what the fridge needs. Only the small sparkling water you took for FOH is suggested.'
    where id = bohf and (trim(coalesce(guide_text, '')) = '' or guide_text = 'Refill FOH first.');

  raise notice 'Refill FOH: % in the FOH beer fridge, % back bar products grabbed from the cupboards',
    (select count(*) from product_placements where check_area_id = beerf),
    (select count(*) from product_placements where check_area_id in (bench, shelves) and pickup_area_id is not null);
end $$;
