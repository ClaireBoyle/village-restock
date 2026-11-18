-- Gold Class Bar Back bench: walking order from the sink to the milkshake machine, the bottles on the
-- bench that weren't in the app yet, and a new "Coffee cupboard" area. Run AFTER
-- 2026-11-gold-class-bar-refill-foh.sql. Safe to run more than once. Only touches Gold Class Bar's
-- Back bench and Coffee cupboard (Back shelves is left alone).
--
-- Coffee cupboard (new area, just before the Back bench): the cupboard next to the coffee machine.
--   Sugar container (moved from the Back bench; still a "Needs refill" task from the upstairs cupboard),
--   then the overflow Coffee Beans and Hot Chocolate Powder (both in bags) and Lemon Lime Cordial (staff enter what's
--   needed; collected from Dry storage).
--
-- Back bench, from the sink to the milkshake machine:
--   Liqueurs & Vermouth       the bench's liqueurs and Martini Rosso, then Noilly Prat, Campari, Aperol,
--                             Disaronno, Vok White Crème de Cacao, De Kuyper Crème de Café,
--                             De Kuyper Blue Curaçao, De Kuyper Wild Strawberry, De Kuyper Triple Sec
--   Cocktail Syrups & Mixers  Monin Passion Fruit Purée, Cawsey’s Grenadine, Raspberry, Elderflower, Rose,
--                             Pure Cane Sugar, Master of Mixes Margarita Mixer
--   Spirits                   the bench's spirits
--   Red Wines                 the bench's red wines
--   Milkshake Syrups & Flake  the 8 milkshake syrups, then the Cadbury Flake container
--
-- * Within each group, bottles are left to right as they stand on the bench (from photos of it, from the
--   sink): e.g. Noilly Prat, Campari, Aperol, Martini Rosso, Disaronno … Frangelico, Vok, then the
--   De Kuyper bottles. Anything else on the bench keeps its order, at the end of its group.
--   Running this again puts the bench back in this order (fine-tune afterwards in Admin → Arrange).
-- Back shelves (the glass shelf): St-Germain added between Kraken and Grey Goose, where it stands.
--   Nothing else on the Back shelves moves.
-- * Existing products keep their record, storeroom and pickup (e.g. "grab it from the Spirits cupboard").
--   New bottles are staff-entered and collected from the Alcohol storeroom.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  alc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  dry uuid := coalesce((select id from storage_locations where lower(name) = 'dry storage'), (select id from storage_locations where lower(name) = 'alcohol storeroom'));
  bench uuid; ups uuid; coffee uuid; shelves uuid; anchor int; p uuid; pl uuid; cat uuid; r record; g text; k int := 0; i int; s int;
  -- Coffee cupboard overflow: name, unit (one), unit (more)
  cupboard text[][] := array[
    ['Coffee Beans', 'bag', 'bags'],
    ['Hot Chocolate Powder', 'bag', 'bags'],
    ['Lemon Lime Cordial', 'bottle', 'bottles']
  ];
  -- name, group, category
  adds text[][] := array[
    ['Noilly Prat', 'L', 'Liqueurs'],
    ['Campari', 'L', 'Liqueurs'],
    ['Aperol', 'L', 'Liqueurs'],
    ['Disaronno', 'L', 'Liqueurs'],
    ['Vok White Crème de Cacao', 'L', 'Liqueurs'],
    ['De Kuyper Crème de Café', 'L', 'Liqueurs'],
    ['De Kuyper Blue Curaçao', 'L', 'Liqueurs'],
    ['De Kuyper Wild Strawberry', 'L', 'Liqueurs'],
    ['De Kuyper Triple Sec', 'L', 'Liqueurs'],
    ['Cawsey’s Grenadine', 'C', 'Syrups'],
    ['Master of Mixes Margarita Mixer', 'C', 'Syrups'],
    ['Monin Passion Fruit Purée', 'C', 'Syrups']
  ];
  groups text[] := array['L', 'C', 'S', 'R', 'M', 'Z'];
  -- The bench left to right, from the sink to the milkshake machine (group, name).
  walk text[][] := array[
    ['L', 'Noilly Prat'], ['L', 'Campari'], ['L', 'Aperol'], ['L', 'Martini Rosso'], ['L', 'Disaronno'], ['L', 'Midori'],
    ['L', 'Malibu'], ['L', 'Kahlua'], ['L', 'Baileys'], ['L', 'Hellyers Road Whisky Cream Liqueur'], ['L', 'Frangelico'],
    ['L', 'Vok White Crème de Cacao'], ['L', 'De Kuyper Blue Curaçao'], ['L', 'De Kuyper Wild Strawberry'],
    ['L', 'De Kuyper Crème de Café'], ['L', 'De Kuyper Triple Sec'],
    ['C', 'Monin Passion Fruit Purée'], ['C', 'Cawsey’s Grenadine'], ['C', 'Raspberry Syrup'], ['C', 'Elderflower Syrup'], ['C', 'Rose Syrup'],
    ['C', 'Pure Cane Sugar Syrup'], ['C', 'Master of Mixes Margarita Mixer'],
    ['S', '42 Below'], ['S', 'Bacardi Carta Blanca'], ['S', 'Jack Daniels'], ['S', 'Jim Beam White Label'], ['S', 'Bombay Sapphire'],
    ['R', 'Alexander Hill Shiraz'], ['R', 'Red Claw Shiraz'], ['R', 'Red Claw Pinot Noir'], ['R', 'Heathcote Estate Shiraz'],
    ['R', 'Tarrawarra Pinot Noir'], ['R', 'Mt Yengo Chilled Shiraz'],
    ['M', 'Vanilla Syrup'], ['M', 'Caramel Syrup'], ['M', 'Mint Syrup'], ['M', 'Strawberry Syrup'], ['M', 'Chocolate Syrup'],
    ['M', 'Banana Syrup'], ['M', 'Cherry Syrup'], ['M', 'Orange Syrup'], ['M', 'Cadbury Flake container']
  ];
  w int;
  heads text[] := array['Liqueurs & Vermouth', 'Cocktail Syrups & Mixers', 'Spirits', 'Red Wines', 'Milkshake Syrups & Flake', 'Other'];
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if alc is null then raise exception 'The storeroom "Alcohol storeroom" must exist first'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'pickup_area_id') then
    raise exception 'Run db/migrations/012_foh_pickups.sql first';
  end if;
  bench := (select id from check_areas where department_id = dept and active and lower(name) = 'back bench' limit 1);
  if bench is null then raise notice 'No Back bench in Gold Class Bar: nothing changed'; return; end if;
  ups := (select id from check_areas where department_id = dept and active and lower(name) = 'upstairs cupboards' limit 1);

  -- 0. The Coffee cupboard, just before the Back bench.
  coffee := (select id from check_areas where department_id = dept and lower(name) = 'coffee cupboard' order by active desc limit 1);
  if coffee is null then
    s := (select sort_order from check_areas where id = bench);
    update check_areas set sort_order = sort_order + 1 where department_id = dept and sort_order >= s and parent_area_id is null;
    insert into check_areas (department_id, name, sort_order, guide_text)
      values (dept, 'Coffee cupboard', s, 'The cupboard next to the coffee machine. Add only what needs topping up.') returning id into coffee;
  end if;
  update check_areas set active = true, parent_area_id = null where id = coffee;
  -- The sugar container moves here from the Back bench (same record and pickup).
  p := (select id from products where department_id = dept and lower(name) = 'sugar container' and status = 'active' limit 1);
  if p is not null then
    if exists (select 1 from product_placements where product_id = p and check_area_id = coffee) then
      delete from product_placements where product_id = p and check_area_id = bench;
    elsif exists (select 1 from product_placements where product_id = p and check_area_id = bench) then
      update product_placements set check_area_id = coffee, heading = null, sort_order = 1 where product_id = p and check_area_id = bench;
    end if;
  end if;
  for i in 1 .. array_length(cupboard, 1) loop
    -- Split into Lemon Cordial and Lime Cordial by 2026-11-gold-class-bar-coffee-cupboard.sql: don't bring it back.
    if lower(cupboard[i][1]) = 'lemon lime cordial'
       and exists (select 1 from products where department_id = dept and lower(name) in ('lime cordial', 'lemon cordial')) then
      continue;
    end if;
    p := (select id from products where department_id = dept and lower(name) = lower(cupboard[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into categories (department_id, name, sort_order) select dept, 'Coffee & Cordial', 100
        where not exists (select 1 from categories where department_id = dept and lower(name) = 'coffee & cordial');
      cat := (select id from categories where department_id = dept and lower(name) = 'coffee & cordial');
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, cupboard[i][1], cupboard[i][2], cupboard[i][3], 'manual', dry, 970 + i) returning id into p;
    else
      update products set status = 'active' where id = p;
    end if;
    if not exists (select 1 from product_placements where product_id = p and check_area_id = coffee) then
      insert into product_placements (product_id, check_area_id, sort_order) values (p, coffee, 1 + i);
    end if;
  end loop;

  -- 1. The bottles on the bench that aren't in the app yet (matched by name, ignoring case, accents and apostrophes).
  for i in 1 .. array_length(adds, 1) loop
    p := (select id from products where department_id = dept
            and translate(lower(name), 'èéêëçàâ''’', 'eeeecaa') = translate(lower(adds[i][1]), 'èéêëçàâ''’', 'eeeecaa')
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into categories (department_id, name, sort_order) select dept, adds[i][3], 100
        where not exists (select 1 from categories where department_id = dept and lower(name) = lower(adds[i][3]));
      cat := (select id from categories where department_id = dept and lower(name) = lower(adds[i][3]));
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, adds[i][1], 'bottle', 'bottles', 'manual', alc, 980 + i) returning id into p;
    else
      update products set status = 'active' where id = p; -- its storeroom and units stay as they are
    end if;
    if not exists (select 1 from product_placements where product_id = p and check_area_id = bench) then
      -- Grabbed from an upstairs cupboard only if a cupboard holds it; otherwise straight from downstairs.
      insert into product_placements (product_id, check_area_id, sort_order, pickup_area_id, pickup_suggest)
        select p, bench, 5000 + i, c.id, c.id is not null
        from (select (select x.check_area_id from product_placements x join check_areas a on a.id = x.check_area_id and a.active
                      where x.product_id = p and a.parent_area_id = ups limit 1) as id) c;
    end if;
  end loop;

  -- 2. Which stop each product on the bench belongs to: by the group it sits under now, with the new
  --    bottles and the two containers placed by name.
  create temp table bench_walk (id uuid, grp text, ord int) on commit drop;
  g := null;
  for r in
    select x.id, x.heading, x.sort_order, lower(pr.name) as name, lower(coalesce(c.name, '')) as cat
    from product_placements x join products pr on pr.id = x.product_id left join categories c on c.id = pr.category_id
    where x.check_area_id = bench order by x.sort_order, x.created_at
  loop
    if r.heading is not null then
      g := case
        when lower(r.heading) like '%liqueur%' or lower(r.heading) like '%vermouth%' then 'L'
        when lower(r.heading) like '%cocktail%' or lower(r.heading) like '%mocktail%' or lower(r.heading) like '%mixer%' then 'C'
        when lower(r.heading) like '%spirit%' then 'S'
        when lower(r.heading) like '%red wine%' then 'R'
        when lower(r.heading) like '%milkshake%' then 'M'
        else null end;
    end if;
    -- Its spot on the bench, if it's one of the bottles in the walk.
    w := (select j from generate_subscripts(walk, 1) j
          where translate(lower(walk[j][2]), 'èéêëçàâ''’', 'eeeecaa') = translate(r.name, 'èéêëçàâ''’', 'eeeecaa') limit 1);
    insert into bench_walk values (r.id, case
      when w is not null then walk[w][1]
      when r.name = 'cadbury flake container' then 'M'
      when r.sort_order > 5000 then (select adds[j][2] from generate_subscripts(adds, 1) j
                                     where translate(lower(adds[j][1]), 'èéêëçàâ''’', 'eeeecaa') = translate(r.name, 'èéêëçàâ''’', 'eeeecaa') limit 1)
      when g is not null then g
      when r.cat in ('liqueurs', 'liqueur', 'vermouth') then 'L'
      when r.cat = 'syrups' then 'C'
      when r.cat = 'red wine' then 'R'
      when r.cat in ('vodka', 'gin', 'tequila', 'whisky', 'whiskey', 'bourbon', 'rum') then 'S'
      else 'Z' end, coalesce(w, 1000 + r.sort_order));
  end loop;

  -- 3. Renumber in walking order, with one heading at the start of each stop.
  for r in select w.id, w.grp, row_number() over (partition by w.grp order by w.ord) as n
           from bench_walk w order by array_position(groups, coalesce(w.grp, 'Z')), w.ord
  loop
    k := k + 1;
    update product_placements set sort_order = k,
      heading = case when r.n = 1 then heads[array_position(groups, coalesce(r.grp, 'Z'))] else null end
      where id = r.id;
  end loop;

  -- Hot chocolate comes in bags (fixes an earlier version of this script that used tubs).
  update products set unit_singular = 'bag', unit_plural = 'bags'
    where department_id = dept and lower(name) = 'hot chocolate powder' and unit_plural = 'tubs';

  -- 5. St-Germain on the Back shelves (glass shelf), between Kraken and Grey Goose.
  shelves := (select id from check_areas where department_id = dept and active and lower(name) = 'back shelves' limit 1);
  if shelves is not null then
    p := (select id from products where department_id = dept
            and regexp_replace(translate(lower(name), 'èéêëçàâ', 'eeeecaa'), '[^a-z]', '', 'g') in ('stgermain', 'stgermainelderflowerliqueur')
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into categories (department_id, name, sort_order) select dept, 'Liqueurs', 100
        where not exists (select 1 from categories where department_id = dept and lower(name) = 'liqueurs');
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, (select id from categories where department_id = dept and lower(name) = 'liqueurs'), 'St-Germain', 'bottle', 'bottles', 'manual', alc, 995)
        returning id into p;
    else
      update products set status = 'active' where id = p;
    end if;
    if not exists (select 1 from product_placements where product_id = p and check_area_id = shelves) then
      anchor := coalesce((select x.sort_order from product_placements x join products pr on pr.id = x.product_id
                          where x.check_area_id = shelves and lower(pr.name) like 'kraken%' limit 1),
                         (select max(sort_order) from product_placements where check_area_id = shelves), 0);
      update product_placements set sort_order = sort_order + 1 where check_area_id = shelves and sort_order > anchor;
      insert into product_placements (product_id, check_area_id, sort_order, pickup_area_id, pickup_suggest)
        select p, shelves, anchor + 1, c.id, c.id is not null
        from (select (select x.check_area_id from product_placements x join check_areas a on a.id = x.check_area_id and a.active
                      where x.product_id = p and a.parent_area_id = ups limit 1) as id) c;
    end if;
  end if;

  -- 4. A one-line route (only replaces the earlier wording).
  update check_areas set guide_text = 'From the sink to the milkshake machine, left to right. Add only what needs topping up.'
    where id = bench and (trim(coalesce(guide_text, '')) = '' or guide_text like 'Grab from the upstairs cupboards%' or guide_text like 'Use the upstairs cupboards first%');
  raise notice 'Back bench: % products in walking order; Coffee cupboard: % products', k,
    (select count(*) from product_placements where check_area_id = coffee);
end $$;
