-- Gold Class Bar → Confection: Fairy Floss, with the Parlour Lane popcorn. Safe to run more than once.
-- Only touches Gold Class Bar.
--
-- * A Gold Class Bar product "Fairy Floss" (tubs, staff enter what's needed), in the same category and storeroom as
--   the bar's Parlour Lane popcorn, so it's checked and collected alongside it. It uses the Candy Bar's Fairy Floss
--   photo. If the bar already has a Fairy Floss, that one is used.
-- * On the Confection screen it goes straight after the last Parlour Lane popcorn, and the "Packaged Popcorn" heading
--   becomes "Popcorn & Fairy Floss".
do $$
declare
  bar uuid := (select id from departments where lower(name) = 'gold class bar');
  conf uuid; pop record; ff uuid; s int;
begin
  if bar is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  conf := (select id from check_areas where department_id = bar and active and parent_area_id is null and lower(name) = 'confection' limit 1);
  if conf is null then raise notice 'Confection not found: nothing changed'; return; end if;
  -- The last Parlour Lane popcorn on the Confection screen.
  select x.sort_order, q.category_id, q.default_location_id into pop
    from product_placements x join products q on q.id = x.product_id
    where x.check_area_id = conf and q.name ilike 'Parlour Lane Popcorn%' and q.status = 'active'
    order by x.sort_order desc limit 1;
  if pop is null then raise notice 'No Parlour Lane popcorn on Confection: nothing changed'; return; end if;

  ff := (select id from products where department_id = bar and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'fairyfloss' order by status = 'active' desc limit 1);
  if ff is null then
    insert into products (department_id, category_id, name, unit_singular, unit_plural, method, allow_decimal, instructions, default_location_id, photo_path, status, sort_order)
      values (bar, pop.category_id, 'Fairy Floss', 'tub', 'tubs', 'manual', false, '', pop.default_location_id,
        (select photo_path from products where department_id <> bar and lower(name) = 'fairy floss' and photo_path is not null limit 1),
        'active', coalesce((select max(sort_order) from products where department_id = bar), 0) + 1)
      returning id into ff;
  else
    update products set status = 'active' where id = ff;
  end if;

  -- Straight after the popcorn (rows after it move down one).
  s := pop.sort_order;
  if not exists (select 1 from product_placements where check_area_id = conf and product_id = ff) then
    update product_placements set sort_order = sort_order + 1 where check_area_id = conf and sort_order > s;
    insert into product_placements (product_id, check_area_id, sort_order) values (ff, conf, s + 1);
  end if;
  update product_placements set heading = 'Popcorn & Fairy Floss' where check_area_id = conf and heading = 'Packaged Popcorn';

  raise notice 'Confection, from the popcorn on: %', (select string_agg(case when x.heading is not null then '[' || x.heading || '] ' else '' end || q.name, ', ' order by x.sort_order)
    from product_placements x join products q on q.id = x.product_id
    where x.check_area_id = conf and q.status = 'active' and x.sort_order >= (select min(y.sort_order) from product_placements y join products r on r.id = y.product_id
      where y.check_area_id = conf and r.name ilike 'Parlour Lane Popcorn%'));
  raise notice 'Fairy Floss: % (photo %)', (select unit_singular || '/' || unit_plural from products where id = ff), (select coalesce(photo_path, 'none') from products where id = ff);
end $$;
