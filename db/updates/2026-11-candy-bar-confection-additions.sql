-- Candy Bar confection stand: new products and a rename. Safe to run more than once.
-- Only touches Candy Bar's "Confection stand".
--
--   Renamed: Skittles Jellies → Skittles Jellies Kittens (same product, photo and history)
--   Added:   Skittles Jellies Pandas          (after Kittens)
--            Fairy Floss                      (end of the lollies)
--            Cookie Time Strawberries & Cream (end of the chocolate)
--            Thins Light & Tangy              (after Smith's Salt & Vinegar)
--            Mount Franklin Still Water       (end of the stand; the same product as in the drinks fridge)
--
-- * Staff enter what's needed (no targets). Collected from Candy Bar BOH, except the water,
--   which comes from where it already does (Walk in fridge, Downstairs).
-- * New products go next to similar ones. On a second run nothing moves, so any
--   reordering done in Admin → Arrange is kept.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'candy bar');
  boh uuid := (select id from storage_locations where lower(name) = 'candy bar boh');
  stand uuid; p uuid; pl uuid; cat uuid; anchor int; r record;
begin
  if dept is null then raise notice 'Candy Bar not found: nothing changed'; return; end if;
  stand := (select id from check_areas where department_id = dept and active and lower(name) = 'confection stand' limit 1);
  if stand is null then raise notice 'Candy Bar has no Confection stand: nothing changed'; return; end if;

  -- 1. Rename (only if the new name isn't taken yet).
  update products set name = 'Skittles Jellies Kittens'
    where department_id = dept and lower(name) = 'skittles jellies'
      and not exists (select 1 from products where department_id = dept and lower(name) = 'skittles jellies kittens');

  -- 2. Add: name, unit (one), unit (more), category, placed after this product ('' = at the end)
  for r in select * from (values
      (1, 'Skittles Jellies Pandas', 'packet', 'packets', 'Lollies & Gummies', 'Skittles Jellies Kittens'),
      (2, 'Fairy Floss', 'packet', 'packets', 'Lollies & Gummies', 'Berry Nerds Gummy Clusters'),
      (3, 'Cookie Time Strawberries & Cream', 'cookie', 'cookies', 'Cookies', 'Snickers Bar'),
      (4, 'Thins Light & Tangy', 'packet', 'packets', 'Chips & Savoury', 'Smith''s Salt & Vinegar'),
      (5, 'Mount Franklin Still Water', 'bottle', 'bottles', 'Water', '')) v(k, name, one, many, catname, after)
    order by k
  loop
    insert into categories (department_id, name, sort_order) select dept, r.catname, 100
      where not exists (select 1 from categories where department_id = dept and lower(name) = lower(r.catname));
    cat := (select id from categories where department_id = dept and lower(name) = lower(r.catname));
    p := (select id from products where department_id = dept and lower(name) = lower(r.name) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, r.name, r.one, r.many, 'manual', coalesce(boh, (select id from storage_locations order by sort_order limit 1)), 900 + r.k)
        returning id into p;
    else
      update products set status = 'active' where id = p;
    end if;
    -- Already on the stand: leave it where it is.
    if exists (select 1 from product_placements where product_id = p and check_area_id = stand) then continue; end if;
    anchor := (select pl2.sort_order from product_placements pl2 join products x on x.id = pl2.product_id
               where pl2.check_area_id = stand and lower(x.name) = lower(r.after) and x.status = 'active' limit 1);
    if anchor is null then
      anchor := coalesce((select max(sort_order) from product_placements where check_area_id = stand), 0);
    end if;
    update product_placements set sort_order = sort_order + 1 where check_area_id = stand and sort_order > anchor;
    insert into product_placements (product_id, check_area_id, sort_order) values (p, stand, anchor + 1);
  end loop;

  raise notice 'Confection stand: % products', (select count(*) from product_placements pl join products x on x.id = pl.product_id and x.status = 'active' where pl.check_area_id = stand);
end $$;
