-- Gold Class Bar: popcorn boxes, cups and lids, counted in sleeves. Safe to run more than once.
-- Only touches Gold Class Bar's "Popcorn boxes" and "Cups/lids storage" checking areas.
--
--   Popcorn boxes:      Popcorn Box Small, Medium, Large, XL
--   Cups/lids storage:  Cups  · Cup Small, Medium, Large, XL
--                       Lids  · Lid Small/Medium, Lid Large, Lid XL
--
-- * Staff enter how many sleeves they need (no targets). Collected from Dry storage
--   (change it in Admin > Products if they come from somewhere else).
-- * Existing products with the same name are reused, never duplicated.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  dry uuid := (select id from storage_locations where lower(name) = 'dry storage');
  cat uuid; area uuid; p uuid; pl uuid; i int;
  -- area, product name, heading above it
  list text[][] := array[
    ['popcorn boxes', 'Popcorn Box Small', ''],
    ['popcorn boxes', 'Popcorn Box Medium', ''],
    ['popcorn boxes', 'Popcorn Box Large', ''],
    ['popcorn boxes', 'Popcorn Box XL', ''],
    ['cups/lids storage', 'Cup Small', 'Cups'],
    ['cups/lids storage', 'Cup Medium', ''],
    ['cups/lids storage', 'Cup Large', ''],
    ['cups/lids storage', 'Cup XL', ''],
    ['cups/lids storage', 'Lid Small/Medium', 'Lids'],
    ['cups/lids storage', 'Lid Large', ''],
    ['cups/lids storage', 'Lid XL', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  insert into categories (department_id, name, sort_order) select dept, 'Packaging', 100
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'packaging');
  cat := (select id from categories where department_id = dept and lower(name) = 'packaging');
  for i in 1 .. array_length(list, 1) loop
    -- (found by name, also after a rename such as "Cups, Lids & Straws storage")
    area := (select id from check_areas where department_id = dept and active
             and lower(name) like case when list[i][1] = 'popcorn boxes' then 'popcorn%' else 'cups%lids%' end order by sort_order limit 1);
    if area is null then
      insert into check_areas (department_id, name, sort_order)
        values (dept, case when list[i][1] = 'popcorn boxes' then 'Popcorn boxes' else 'Cups/lids storage' end, 50) returning id into area;
    end if;
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][2]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][2], 'sleeve', 'sleeves', 'manual', dry, 700 + i) returning id into p;
    else
      update products set status = 'active', method = 'manual', unit_singular = 'sleeve', unit_plural = 'sleeves',
        category_id = coalesce(category_id, cat), default_location_id = coalesce(default_location_id, dry) where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl; end if;
    update product_placements set sort_order = i, par_level = null, location_id = null,
      heading = nullif(list[i][3], '') where id = pl;
  end loop;
  raise notice 'Popcorn boxes, cups and lids added';
end $$;
