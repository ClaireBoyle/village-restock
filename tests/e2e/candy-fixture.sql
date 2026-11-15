-- Realistic Candy Bar layout for testing the redesign (test database only).
do $$
declare
  dept uuid := (select id from departments where name = 'Candy Bar');
  boh uuid; dry uuid; wif uuid; stand uuid; fridge uuid; p uuid; i int := 0;
  sweets text[] := array['Milk M&M''s','Peanut M&M''s','Crispy M&M''s','Maltesers','Pods','Skittles','Starburst','Natural Jelly Snakes','Party Mix','Sour Patch Kids',
    'Kit Kat','Twix','Snickers','Mars Bar','Cherry Ripe','Caramello Koala','Freddo','Toblerone','Lindt Milk','Lindt Dark',
    'Allen''s Killer Pythons','Allen''s Jelly Beans','Fantales','Jaffas','Smarties','Milky Way','Crunchie','Violet Crumble','Pringles Original','Pringles Sour Cream & Onion Extra Long Name Edition'];
  drinks text[] := array['Fuze Peach Iced Tea','Monster Original','Monster White','Monster Peach','Monster Lando Norris','Pump','Pump Berry',
    'Mount Franklin Still Water','Mount Franklin Sparkling Water','Coca-Cola Bottle','Coca-Cola No Sugar Bottle','Sprite Bottle',
    'Apple Juice Box','Apple & Blackcurrant Juice Box','Tropical Juice Box','Orange Juice Box','Skinny Milk','Oat Milk','Soy Milk'];
  general text := 'Check both sides of the stand and enter the total number of packets needed. Collect from Candy Bar BOH first, then Dry storage.';
  s text; coke uuid;
begin
  update check_areas set active = false where department_id = dept;
  insert into storage_locations (name, sort_order) values ('Candy Bar BOH', 0) returning id into boh;
  insert into storage_locations (name, sort_order) values ('Walk in fridge(Downstairs)', 1) returning id into wif;
  insert into storage_locations (name, sort_order) values ('Dry storage', 2) returning id into dry;
  insert into check_areas (department_id, name, guide_text, sort_order) values (dept, 'Confection stand',
    'Check both sides of the stand and enter the total number of packets required for each product. For example, if one side needs 3 packets and the other needs 2, enter 5.', 1) returning id into stand;
  insert into check_areas (department_id, name, guide_text, sort_order) values (dept, 'FOH drinks fridge', '', 2) returning id into fridge;
  foreach s in array sweets loop
    i := i + 1;
    insert into products (department_id, name, unit_singular, unit_plural, method, instructions, default_location_id, sort_order)
      values (dept, s, 'packet', 'packets', 'manual', case when s = 'Toblerone' then 'Keep away from the heat lamp.' else general end, boh, 100 + (31 - i)) returning id into p;
    insert into product_placements (product_id, check_area_id, sort_order) values (p, stand, i);
  end loop;
  i := 0;
  foreach s in array drinks loop
    i := i + 1;
    insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, s, case when s like '%Milk' then 'carton' else 'bottle' end, case when s like '%Milk' then 'cartons' else 'bottles' end, 'manual', wif, 200 + (20 - i)) returning id into p;
    insert into product_placements (product_id, check_area_id, sort_order) values (p, fridge, i);
    if s = 'Coca-Cola Bottle' then coke := p; end if;
  end loop;
  -- Coke is also sold from the stand: same product, two areas, one collection line
  insert into product_placements (product_id, check_area_id, sort_order) values (coke, stand, 31);
end $$;
