-- Gold Class Bar: the spirits get their own checking area, "Back shelves", right after the Back bench.
-- Safe to run more than once. Only touches Gold Class Bar's Back bench, Back shelves and Spirits cupboard.
--
-- * Back bench keeps the red wines (and anything that isn't a spirit).
-- * Back shelves gets the spirits from the Back bench, in their current order, with small headings:
--   Vodka · Gin & Tequila · Whisky & Bourbon · Rum · Liqueurs (anything else under "Other Spirits").
--   The products are moved, not copied: the same products, ids, photos and units.
-- * The Spirits cupboard (extra stock from downstairs) becomes the optional section of Back shelves.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  bench uuid; shelves uuid; cupboard uuid; s int;
  spirit_cats text[] := array['vodka', 'gin', 'tequila', 'whisky', 'whiskey', 'bourbon', 'rum', 'liqueurs', 'liqueur'];
  groups jsonb := '[
    {"label": "Vodka", "cats": ["vodka"]},
    {"label": "Gin & Tequila", "cats": ["gin", "tequila"]},
    {"label": "Whisky & Bourbon", "cats": ["whisky", "whiskey", "bourbon"]},
    {"label": "Rum", "cats": ["rum"]},
    {"label": "Liqueurs", "cats": ["liqueurs", "liqueur"]}]';
  r record; k int; prev int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  bench := (select id from check_areas where department_id = dept and lower(name) = 'back bench');
  if bench is null then raise notice 'No Back bench in Gold Class Bar: nothing changed'; return; end if;

  -- 1. The Back shelves area, straight after the Back bench (and its sections).
  shelves := (select id from check_areas where department_id = dept and lower(name) = 'back shelves');
  if shelves is null then
    s := (select sort_order from check_areas where id = bench);
    update check_areas set sort_order = sort_order + 1 where department_id = dept and sort_order > s and id <> bench;
    insert into check_areas (department_id, name, sort_order) values (dept, 'Back shelves', s + 1) returning id into shelves;
  end if;
  update check_areas set active = true where id = shelves;

  -- 2. Move the spirits from the Back bench (a spirit already on the Back shelves just leaves the bench).
  delete from product_placements pl using products p left join categories c on c.id = p.category_id
    where pl.product_id = p.id and pl.check_area_id = bench and lower(coalesce(c.name, '')) = any(spirit_cats)
      and exists (select 1 from product_placements x where x.product_id = p.id and x.check_area_id = shelves);
  update product_placements pl set check_area_id = shelves, sort_order = 1000 + pl.sort_order
    from products p left join categories c on c.id = p.category_id
    where pl.product_id = p.id and pl.check_area_id = bench and lower(coalesce(c.name, '')) = any(spirit_cats);

  -- 3. Back shelves: grouped by category, keeping the current order within each group.
  k := 0; prev := -1;
  for r in
    select pl.id, coalesce((select (gx.ord - 1)::int from jsonb_array_elements(groups) with ordinality gx(grp, ord)
             where lower(coalesce(c.name, '')) in (select jsonb_array_elements_text(gx.grp->'cats')) limit 1), 99) as gi
    from product_placements pl join products p on p.id = pl.product_id left join categories c on c.id = p.category_id
    where pl.check_area_id = shelves order by 2, pl.sort_order, pl.created_at
  loop
    k := k + 1;
    update product_placements set sort_order = k,
      heading = case when r.gi <> prev then (case when r.gi = 99 then 'Other Spirits' else (groups->r.gi)->>'label' end) else null end
      where id = r.id;
    prev := r.gi;
  end loop;

  -- 4. The Back bench keeps its red wines under one "Red Wines" heading. Renumber it.
  k := 0;
  for r in select pl.id from product_placements pl where pl.check_area_id = bench order by pl.sort_order, pl.created_at loop
    k := k + 1;
    update product_placements set sort_order = k, heading = case when k = 1 then 'Red Wines' else null end where id = r.id;
  end loop;

  -- 5. The Spirits cupboard is extra spirits from downstairs: the optional section of Back shelves.
  cupboard := (select id from check_areas where department_id = dept and lower(name) = 'spirits cupboard');
  if cupboard is not null and exists (select 1 from information_schema.columns where table_name = 'check_areas' and column_name = 'parent_area_id') then
    update check_areas set parent_area_id = shelves, section_mode = 'optional' where id = cupboard;
  end if;
  raise notice 'Back shelves: % spirits', (select count(*) from product_placements where check_area_id = shelves);
end $$;
