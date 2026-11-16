-- Gold Class Bar Walk in fridge: fresh produce and juices at the top, then the wines.
-- Safe to run more than once. Only touches the Gold Class Bar "Walk in fridge" checking area.
--
--   Fresh Produce:   Lemons, Limes, Strawberries, Oranges, Passionfruit, Maraschino Cherries
--   Juices & Water:  Orange Juice, Pineapple Juice, Apple Juice, Cranberry Juice, Mount Franklin Still Water
--   then the wines, in their current order and groups (the Moscato first in Sparkling & Champagne).
--
-- * Existing products are reused (the juices from the BOH bar fridge): same product, so the
--   collection list adds them up. Their names, units and photos are kept. Missing ones are added.
-- * All staff-entered, no targets, collected from Walk in fridge(Downstairs).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  walkin uuid := (select id from storage_locations where lower(name) = 'walk in fridge(downstairs)');
  area uuid;
  -- name, unit (one), unit (more), category, heading above it
  list text[][] := array[
    ['Lemons', 'lemon', 'lemons', 'Fresh Produce', 'Fresh Produce'],
    ['Limes', 'lime', 'limes', 'Fresh Produce', ''],
    ['Strawberries', 'punnet', 'punnets', 'Fresh Produce', ''],
    ['Oranges', 'orange', 'oranges', 'Fresh Produce', ''],
    ['Passionfruit', 'passionfruit', 'passionfruit', 'Fresh Produce', ''],
    ['Maraschino Cherries', 'jar', 'jars', 'Fresh Produce', ''],
    ['Orange Juice', 'bottle', 'bottles', 'Juices & Water', 'Juices & Water'],
    ['Pineapple Juice', 'bottle', 'bottles', 'Juices & Water', ''],
    ['Apple Juice', 'bottle', 'bottles', 'Juices & Water', ''],
    ['Cranberry Juice', 'bottle', 'bottles', 'Juices & Water', ''],
    ['Mount Franklin Still Water', 'bottle', 'bottles', 'Juices & Water', '']
  ];
  i int; p uuid; pl uuid; cat uuid; top uuid[] := '{}';
  rest uuid[]; heads text[]; m int; g int; f int; k int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if walkin is null then raise exception 'The storeroom "Walk in fridge(Downstairs)" must exist first'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  area := (select id from check_areas where department_id = dept and lower(name) = 'walk in fridge');
  if area is null then raise notice 'Gold Class Bar has no "Walk in fridge" area: nothing changed'; return; end if;

  -- 1. The 11 products (reused or added) and their place in the fridge.
  for i in 1 .. array_length(list, 1) loop
    insert into categories (department_id, name, sort_order) select dept, list[i][4], 100
      where not exists (select 1 from categories where department_id = dept and lower(name) = lower(list[i][4]));
    cat := (select id from categories where department_id = dept and lower(name) = lower(list[i][4]));
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][1], list[i][2], list[i][3], 'manual', walkin, 600 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat),
        default_location_id = coalesce(default_location_id, walkin) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, 0) returning id into pl; end if;
    update product_placements set par_level = null, location_id = null where id = pl;
    top := top || pl;
  end loop;

  -- 2. Everything else already in the fridge (the wines), in its current order with its subheadings.
  select coalesce(array_agg(id order by sort_order, created_at), '{}'), coalesce(array_agg(heading order by sort_order, created_at), '{}')
    into rest, heads from product_placements where check_area_id = area and not (id = any(top));
  if array_length(rest, 1) > 0 then
    -- The wines start with a subheading (otherwise the first wines would fall under Juices & Water).
    f := (select min(x.n) from unnest(heads) with ordinality x(h, n) where x.h is not null);
    if heads[1] is null and f is not null then heads[1] := heads[f]; heads[f] := null; end if;
    -- The Moscato leads its group (it was asked to come before Chandon NV).
    m := (select x.n from unnest(rest) with ordinality x(id, n) join product_placements q on q.id = x.id join products pr on pr.id = q.product_id
          where lower(pr.name) = 'dunes & greene split pick moscato' limit 1);
    if m is not null then
      g := coalesce((select max(x.n) from unnest(heads) with ordinality x(h, n) where x.n <= m and x.h is not null), 1);
      if m > g then
        rest := rest[1:g-1] || rest[m] || rest[g:m-1] || rest[m+1:];
        heads := heads[1:g-1] || heads[g] || array[null::text] || heads[g+1:m-1] || heads[m+1:];
      end if;
    end if;
  end if;

  -- 3. Write the order: the 11 first, then the wines.
  k := 0;
  for i in 1 .. array_length(top, 1) loop
    k := k + 1;
    update product_placements set sort_order = k, heading = nullif(list[i][5], '') where id = top[i];
  end loop;
  for i in 1 .. coalesce(array_length(rest, 1), 0) loop
    k := k + 1;
    update product_placements set sort_order = k, heading = heads[i] where id = rest[i];
  end loop;
  raise notice 'Walk in fridge: % products arranged', k;
end $$;
