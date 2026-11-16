-- Gold Class Bar: Whipping Cream beside Whipped Cream, and small category subheadings in the
-- Walk in fridge, Back bench and Spirits cupboard. Run AFTER db/migrations/011_placement_headings.sql
-- and db/updates/2026-11-gold-class-bar-boh-fridge.sql. Safe to run more than once.
--
-- * Nothing is deleted. No products are renamed. Whipped Cream is untouched.
-- * Products are grouped by their existing category; within a group they keep their current order.
--   A product with no matching category goes to the end (under "Other …" only if there is one).
-- * The Spirits cupboard becomes an optional, collapsed section of the Back bench (as discussed),
--   so the Back bench stays first and the cupboard is only for extra stock from downstairs.
-- * Collection quantities, storerooms and targets are not changed.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  walkin uuid := (select id from storage_locations where lower(name) = 'walk in fridge(downstairs)');
  boh uuid; bench uuid; cupboard uuid; whipped uuid; whipping uuid; wpl uuid; s int;
  cfg jsonb := '[
    {"area": "walk in fridge", "rest": "Other", "groups": [
      {"label": "Sparkling & Champagne", "cats": ["sparkling wine", "champagne"], "names": []},
      {"label": "White Wine", "cats": ["white wine"], "names": []},
      {"label": "Rosé & Chilled Shiraz", "cats": ["rosé wine", "rose wine"], "names": ["mt yengo chilled shiraz"]}]},
    {"area": "back bench", "rest": "Popular Spirits", "groups": [
      {"label": "Red Wines", "cats": ["red wine"], "names": []}]},
    {"area": "spirits cupboard", "rest": "Other Spirits", "groups": [
      {"label": "Vodka", "cats": ["vodka"], "names": []},
      {"label": "Gin & Tequila", "cats": ["gin", "tequila"], "names": []},
      {"label": "Whisky & Bourbon", "cats": ["whisky", "whiskey", "bourbon"], "names": []},
      {"label": "Rum", "cats": ["rum"], "names": []},
      {"label": "Liqueurs", "cats": ["liqueurs", "liqueur"], "names": []}]}
  ]';
  a jsonb; g jsonb; area uuid; r record; gi int; k int; prev int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;

  -- 1. Whipping Cream, directly after Whipped Cream in the BOH bar fridge (its own product).
  boh := (select id from check_areas where department_id = dept and lower(name) = 'boh bar fridge');
  whipped := (select id from products where department_id = dept and lower(name) = 'whipped cream' and status = 'active' limit 1);
  if boh is not null and whipped is not null then
    whipping := (select id from products where department_id = dept and lower(name) = 'whipping cream' order by (status = 'active') desc, created_at limit 1);
    if whipping is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        select dept, p.category_id, 'Whipping Cream', 'carton', 'cartons', 'manual', coalesce(walkin, p.default_location_id), p.sort_order
        from products p where p.id = whipped returning id into whipping;
    else
      update products set status = 'active', method = 'manual' where id = whipping;
    end if;
    s := (select sort_order from product_placements where product_id = whipped and check_area_id = boh);
    wpl := (select id from product_placements where product_id = whipping and check_area_id = boh);
    if s is not null and (wpl is null or (select sort_order from product_placements where id = wpl) <> s + 1) then
      update product_placements set sort_order = sort_order + 1 where check_area_id = boh and sort_order > s and id is distinct from wpl;
      if wpl is null then
        insert into product_placements (product_id, check_area_id, sort_order) values (whipping, boh, s + 1);
      else
        update product_placements set sort_order = s + 1, heading = null, par_level = null where id = wpl;
      end if;
    end if;
  end if;

  -- 2. Category subheadings (only for groups that have products).
  for a in select * from jsonb_array_elements(cfg) loop
    area := (select id from check_areas where department_id = dept and lower(name) = a->>'area');
    continue when area is null;
    k := 0; prev := -1;
    for r in
      select pl.id, pl.sort_order, coalesce((
        select (gx.ord - 1)::int from jsonb_array_elements(a->'groups') with ordinality gx(grp, ord)
        where lower(p.name) in (select jsonb_array_elements_text(gx.grp->'names'))
           or lower(coalesce(c.name, '')) in (select jsonb_array_elements_text(gx.grp->'cats'))
        order by (lower(p.name) in (select jsonb_array_elements_text(gx.grp->'names'))) desc, gx.ord limit 1), 99) as gi
      from product_placements pl join products p on p.id = pl.product_id left join categories c on c.id = p.category_id
      where pl.check_area_id = area
      order by 3, pl.sort_order, pl.created_at
    loop
      k := k + 1;
      update product_placements set sort_order = k,
        heading = case when r.gi <> prev then (case when r.gi = 99 then a->>'rest' else (a->'groups'->r.gi)->>'label' end) else null end
        where id = r.id;
      prev := r.gi;
    end loop;
  end loop;

  -- 3. Spirits cupboard: an optional, collapsed section of the Back bench.
  -- (the section of Back shelves once the spirits have their own area: see 2026-11-gold-class-bar-back-shelves.sql)
  bench := coalesce((select id from check_areas where department_id = dept and lower(name) = 'back shelves'),
                    (select id from check_areas where department_id = dept and lower(name) = 'back bench'));
  cupboard := (select id from check_areas where department_id = dept and lower(name) = 'spirits cupboard');
  if bench is not null and cupboard is not null
     and exists (select 1 from information_schema.columns where table_name = 'check_areas' and column_name = 'parent_area_id')
     and (select parent_area_id from check_areas where id = bench) is null then
    update check_areas set parent_area_id = bench, section_mode = 'optional' where id = cupboard;
  end if;
  raise notice 'Gold Class Bar categories arranged';
end $$;
