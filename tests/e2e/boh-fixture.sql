-- Gold Class Bar's BOH bar fridge as it is live before the reorganisation (test database only):
-- the 12 beers (staff enter, packs, Alcohol storeroom), one with a photo, plus an old extra product
-- and an archived "Whipped Cream" that must be reused, not duplicated.
do $$
declare
  dept uuid := (select id from departments where name = 'Gold Class Bar');
  alc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  area uuid; p uuid; i int := 0; n text;
begin
  if alc is null then insert into storage_locations (name, sort_order) values ('Alcohol storeroom', 1) returning id into alc; end if;
  if not exists (select 1 from storage_locations where lower(name) = 'walk in fridge(downstairs)') then
    insert into storage_locations (name, sort_order) values ('Walk in fridge(Downstairs)', 2);
  end if;
  update check_areas set active = false where department_id = dept;
  insert into check_areas (department_id, name, sort_order) values (dept, 'BOH bar fridge', 0) returning id into area;
  foreach n in array array['Hahn Superdry 3.5','Kirin Ichiban','James Boags Premium','Furphy','Heineken','Little Creatures Rogers','Stone & Wood Pacific Ale',
    'Guinness','James Squire Ginger Beer','Heineken Zero','Little Creatures Pipsqueak Cider','Suntory -196 Lemon','Old Mixer'] loop
    i := i + 1;
    p := (select id from products where department_id = dept and lower(name) = lower(n));
    if p is null then
      insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, n, 'pack', 'packs', 'manual', alc, i) returning id into p;
    else
      update products set method = 'manual', unit_singular = 'pack', unit_plural = 'packs', default_location_id = alc where id = p;
    end if;
    insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) on conflict do nothing;
  end loop;
  update products set photo_path = '/icons/icon-192.png' where department_id = dept and name = 'Heineken';
  insert into products (department_id, name, unit_singular, unit_plural, method, status, sort_order) values (dept, 'Whipped cream', 'can', 'cans', 'manual', 'archived', 99);
end $$;
