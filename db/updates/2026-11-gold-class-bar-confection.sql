-- Gold Class Bar "Confection": the same items as Candy Bar's Confection stand. Safe to run more than once.
-- Only adds to Gold Class Bar; Candy Bar is read, never changed.
--
-- * Products belong to one department, so Gold Class Bar gets its own products with the same
--   names, units, photos and order (existing Gold Class Bar products with the same name are reused).
-- * Grouped by the Candy Bar categories (Chocolate, Lollies & Gummies, Chips & Savoury,
--   Packaged Popcorn) with a small heading for each.
-- * Staff enter what's needed (no targets); collected from the same storeroom as in Candy Bar
--   (Candy Bar BOH). Candy Bar's long stand instructions are not copied.
do $$
declare
  gc uuid := (select id from departments where lower(name) = 'gold class bar');
  cb uuid := (select id from departments where lower(name) = 'candy bar');
  src uuid; dst uuid; r record; p uuid; pl uuid; cat uuid; k int := 0; prev text := null; done uuid[] := '{}';
begin
  if gc is null or cb is null then raise notice 'Gold Class Bar or Candy Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  src := (select id from check_areas where department_id = cb and lower(name) = 'confection stand');
  if src is null then raise notice 'Candy Bar has no Confection stand: nothing changed'; return; end if;
  dst := (select id from check_areas where department_id = gc and lower(name) like 'confection%' order by active desc, sort_order limit 1);
  if dst is null then
    insert into check_areas (department_id, name, sort_order)
      values (gc, 'Confection', coalesce((select max(sort_order) from check_areas where department_id = gc), 0) + 1) returning id into dst;
  end if;

  for r in
    select p.name, p.unit_singular, p.unit_plural, p.allow_decimal, p.photo_path, c.name as cat,
           coalesce(pl.location_id, p.default_location_id) as loc
    from product_placements pl join products p on p.id = pl.product_id and p.status = 'active'
    left join categories c on c.id = p.category_id
    where pl.check_area_id = src order by pl.sort_order, pl.created_at
  loop
    cat := null;
    if r.cat is not null then
      insert into categories (department_id, name, sort_order) select gc, r.cat, 200
        where not exists (select 1 from categories where department_id = gc and lower(name) = lower(r.cat));
      cat := (select id from categories where department_id = gc and lower(name) = lower(r.cat));
    end if;
    p := (select id from products where department_id = gc and lower(name) = lower(r.name) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, allow_decimal, default_location_id, photo_path, sort_order)
        values (gc, cat, r.name, r.unit_singular, r.unit_plural, 'manual', r.allow_decimal, r.loc, r.photo_path, 800 + k) returning id into p;
    else
      update products set status = 'active', category_id = coalesce(category_id, cat), photo_path = coalesce(photo_path, r.photo_path),
        default_location_id = coalesce(default_location_id, r.loc) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = dst limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, dst, 0) returning id into pl; end if;
    k := k + 1;
    update product_placements set sort_order = k, par_level = null, location_id = null,
      heading = case when coalesce(r.cat, '') is distinct from coalesce(prev, '') or k = 1 then r.cat else null end
      where id = pl;
    prev := r.cat;
    done := done || pl;
  end loop;
  -- Anything else already in the Gold Class Bar confection area stays, after these.
  for pl in select id from product_placements where check_area_id = dst and not (id = any(done)) order by sort_order, created_at loop
    k := k + 1;
    update product_placements set sort_order = k, heading = null where id = pl;
  end loop;
  raise notice 'Gold Class Bar Confection: % items', k;
end $$;
