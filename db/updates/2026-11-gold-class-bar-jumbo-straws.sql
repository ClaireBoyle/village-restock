-- Gold Class Bar: Jumbo straws at the Milkshake station (after the Flake container). Safe to run more than once.
-- Run AFTER 2026-11-gold-class-bar-foh-lap.sql. Staff enter how many packets are needed; collected from the
-- Alcohol storeroom (like the milkshake straws). An existing "Jumbo straws" product is reused.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  shake uuid; p uuid;
  alc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  shake := (select id from check_areas where department_id = dept and active and lower(name) = 'milkshake station' limit 1);
  if shake is null then raise exception 'Run 2026-11-gold-class-bar-foh-lap.sql first (it adds the Milkshake station)'; end if;
  p := (select id from products where department_id = dept and lower(name) in ('jumbo straws', 'jumbo straw') order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, (select id from categories where department_id = dept and lower(name) = 'packaging' limit 1),
              'Jumbo straws', 'packet', 'packets', 'manual', coalesce(alc, (select id from storage_locations order by sort_order limit 1)), 999)
      returning id into p;
  else
    update products set status = 'active' where id = p;
  end if;
  if not exists (select 1 from product_placements where product_id = p and check_area_id = shake) then
    insert into product_placements (product_id, check_area_id, sort_order)
      values (p, shake, coalesce((select max(sort_order) from product_placements where check_area_id = shake), 0) + 1);
  end if;
  raise notice 'Milkshake station: % products', (select count(*) from product_placements where check_area_id = shake);
end $$;
