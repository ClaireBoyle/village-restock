-- Test-only Gold Class Bar spirits layout: Back bench + sections (needs migration 008).
do $$
declare
  dept uuid := (select id from departments where name = 'Gold Class Bar');
  alc uuid := (select id from storage_locations where name = 'Alcohol Storeroom');
  bench uuid; foh uuid; cup uuid; p uuid; i int := 0; s text;
  bench_items text[] := array['42 Below', 'Bacardi Carta Blanca', 'Jack Daniel''s', 'Jim Beam'];
  foh_items text[] := array['Tanqueray', 'Hendrick''s', 'Grey Goose', 'Patrón Silver', 'Johnnie Walker Black', 'Kahlúa', 'Baileys'];
  cup_items text[] := array['Jim Beam', 'Jack Daniel''s', 'Bacardi Carta Blanca', 'Hendrick''s', 'Baileys'];
begin
  update check_areas set active = false where department_id = dept;
  insert into check_areas (department_id, name, sort_order) values (dept, 'Back bench', 1) returning id into bench;
  insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode, guide_text) values (dept, 'Other FOH spirits', 2, bench, 'collapsed', 'Top shelf and speed rail, left to right.') returning id into foh;
  insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode) values (dept, 'Spirits cupboard', 3, bench, 'optional') returning id into cup;
  foreach s in array bench_items || foh_items loop
    i := i + 1;
    insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, s, 'bottle', 'bottles', 'manual', alc, 300 + i) returning id into p;
    insert into product_placements (product_id, check_area_id, sort_order) values (p, case when s = any(bench_items) then bench else foh end, i);
  end loop;
  i := 0;
  foreach s in array cup_items loop
    i := i + 1;
    insert into product_placements (product_id, check_area_id, sort_order)
      select id, cup, i from products where department_id = dept and name = s and status = 'active';
  end loop;
end $$;
