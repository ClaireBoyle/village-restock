-- Gold Class Bar syrups on the Back bench, kept on the bench only (no upstairs overflow).
-- Safe to run more than once (also after the earlier version of this file).
--
--   Back bench order:  Cocktail & Mocktail Syrups: Raspberry, Elderflower, Rose, Pure Cane Sugar
--                      ... everything else on the bench, unchanged (red wines, spirits, liqueurs) ...
--                      Milkshake Syrups: Vanilla, Caramel, Strawberry, Chocolate, Banana, Mint, Cherry, Orange
--
-- * Staff enter bottles needed (no targets). Collected from the Alcohol storeroom
--   (change it in Admin > Products if they're kept elsewhere). Not in any cupboard.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  loc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  bench uuid; cat uuid; p uuid; pl uuid; i int; k int := 0; r record;
  cocktail text[] := array['Raspberry Syrup', 'Elderflower Syrup', 'Rose Syrup', 'Pure Cane Sugar Syrup'];
  milkshake text[] := array['Vanilla Syrup', 'Caramel Syrup', 'Strawberry Syrup', 'Chocolate Syrup', 'Banana Syrup',
    'Mint Syrup', 'Cherry Syrup', 'Orange Syrup'];
  allsyr text[];
  firstrest uuid;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  bench := (select id from check_areas where department_id = dept and lower(name) = 'back bench' and active);
  if bench is null then raise notice 'No Back bench in Gold Class Bar: nothing changed'; return; end if;
  allsyr := cocktail || milkshake;
  insert into categories (department_id, name, sort_order) select dept, 'Syrups', 100
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'syrups');
  cat := (select id from categories where department_id = dept and lower(name) = 'syrups');

  -- 1. Make sure each syrup exists (reused if it does) and is on the bench.
  for i in 1 .. array_length(allsyr, 1) loop
    p := (select id from products where department_id = dept and lower(name) = lower(allsyr[i]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, allsyr[i], 'bottle', 'bottles', 'manual', loc, 1000 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat),
        default_location_id = coalesce(default_location_id, loc) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = bench limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, bench, 100000) returning id into pl; end if;
    update product_placements set par_level = null, location_id = null where id = pl;
  end loop;

  -- 2. Cocktail & mocktail syrups first.
  for i in 1 .. array_length(cocktail, 1) loop
    k := k + 1;
    update product_placements pl set sort_order = k, heading = case when i = 1 then 'Cocktail & Mocktail Syrups' else null end
      from products pr where pr.id = pl.product_id and pl.check_area_id = bench and lower(pr.name) = lower(cocktail[i]);
  end loop;
  -- 3. Everything else, in its current order and with its own headings (the first one always has a heading).
  for r in select pl.id, pl.heading from product_placements pl join products pr on pr.id = pl.product_id
           where pl.check_area_id = bench and not (lower(pr.name) = any(select lower(x) from unnest(allsyr) x))
           order by pl.sort_order, pl.created_at loop
    k := k + 1;
    if firstrest is null then
      firstrest := r.id;
      update product_placements set sort_order = k, heading = coalesce(r.heading, 'Red Wines') where id = r.id;
    else
      update product_placements set sort_order = k where id = r.id;
    end if;
  end loop;
  -- 4. Milkshake syrups last.
  for i in 1 .. array_length(milkshake, 1) loop
    k := k + 1;
    update product_placements pl set sort_order = k, heading = case when i = 1 then 'Milkshake Syrups' else null end
      from products pr where pr.id = pl.product_id and pl.check_area_id = bench and lower(pr.name) = lower(milkshake[i]);
  end loop;
  raise notice 'Back bench arranged: % products', k;
end $$;
