-- Gold Class Bar FOH freezer: choc tops, limited-edition HP choc tops, other ice creams,
-- frozen raspberries and Peters vanilla ice cream. Safe to run more than once.
-- Only touches Gold Class Bar's "FOH freezer" checking area.
--
--   Choc Tops:                       Vanilla, Mint, Boysenberry, Salted Caramel, Chocolate
--   HP Choc Tops (limited edition):  Honeycomb, Blueberry, Cinnamon, Chilli Chocolate
--   Other Ice Creams:                Maxibon, Dairy Milk, Connoisseur Salted Caramel, Connoisseur Cookies & Cream
--   Raspberries & Vanilla Ice Cream: Frozen Raspberries, Peters Vanilla Ice Cream (target: 4 tubs)
--
-- * Everything is staff-entered (enter what's needed) except Peters Vanilla Ice Cream, which has a
--   target of 4: staff count the tubs on the shelf and the app works out how many to collect.
-- * Collected from Walk in freezer(Downstairs). Existing products with the same name are reused.
-- * The HP flavours are limited edition: archive them in Admin > Products when they finish.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  freezer uuid := (select id from storage_locations where lower(name) like 'walk in freezer%' order by sort_order limit 1);
  area uuid; p uuid; pl uuid; cat uuid; i int;
  -- name, unit (one), unit (more), category, heading above it, target ('' = staff enter)
  list text[][] := array[
    ['Choc Top Vanilla', 'choc top', 'choc tops', 'Ice Cream', 'Choc Tops', ''],
    ['Choc Top Mint', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['Choc Top Boysenberry', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['Choc Top Salted Caramel', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['Choc Top Chocolate', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['HP Choc Top Honeycomb', 'choc top', 'choc tops', 'Ice Cream', 'HP Choc Tops (limited edition)', ''],
    ['HP Choc Top Blueberry', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['HP Choc Top Cinnamon', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['HP Choc Top Chilli Chocolate', 'choc top', 'choc tops', 'Ice Cream', '', ''],
    ['Maxibon', 'ice cream', 'ice creams', 'Ice Cream', 'Other Ice Creams', ''],
    ['Dairy Milk', 'ice cream', 'ice creams', 'Ice Cream', '', ''],
    ['Connoisseur Salted Caramel', 'ice cream', 'ice creams', 'Ice Cream', '', ''],
    ['Connoisseur Cookies & Cream', 'ice cream', 'ice creams', 'Ice Cream', '', ''],
    ['Frozen Raspberries', 'bag', 'bags', 'Frozen', 'Raspberries & Vanilla Ice Cream', ''],
    ['Peters Vanilla Ice Cream', 'tub', 'tubs', 'Ice Cream', '', '4']
  ];
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if freezer is null then raise exception 'The storeroom "Walk in freezer(Downstairs)" must exist first'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  area := (select id from check_areas where department_id = dept and lower(name) = 'foh freezer' order by active desc limit 1);
  if area is null then
    insert into check_areas (department_id, name, sort_order)
      values (dept, 'FOH freezer', coalesce((select max(sort_order) from check_areas where department_id = dept), 0) + 1) returning id into area;
  end if;
  update check_areas set active = true where id = area;

  for i in 1 .. array_length(list, 1) loop
    insert into categories (department_id, name, sort_order) select dept, list[i][4], 100
      where not exists (select 1 from categories where department_id = dept and lower(name) = lower(list[i][4]));
    cat := (select id from categories where department_id = dept and lower(name) = lower(list[i][4]));
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][1], list[i][2], list[i][3], case when list[i][6] = '' then 'manual' else 'par' end, freezer, 900 + i)
        returning id into p;
    else
      update products set status = 'active', method = case when list[i][6] = '' then 'manual' else 'par' end,
        category_id = coalesce(category_id, cat), default_location_id = coalesce(default_location_id, freezer) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl; end if;
    update product_placements set sort_order = i, location_id = null, heading = nullif(list[i][5], ''),
      par_level = nullif(list[i][6], '')::numeric where id = pl;
  end loop;
  raise notice 'FOH freezer: % products', array_length(list, 1);
end $$;
