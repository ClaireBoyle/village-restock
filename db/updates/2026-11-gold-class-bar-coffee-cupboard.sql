-- Gold Class Bar Coffee cupboard: what's on each shelf, a tea bags tab, and the sugar at the coffee machine.
-- Run AFTER 2026-11-gold-class-bar-foh-lap.sql. Safe to run more than once. Only touches Gold Class Bar.
--
--   Top shelf        Coffee Beans, Hot Chocolate Powder, Decaf Coffee, Chai Powder, Matcha Powder, Biscoff Biscuits
--   Bottom shelf     Lemon Cordial, Lime Cordial, Raspberry Cordial, Bitters, Orange Bitters, Honey, Hazelnut Syrup
--   Tea bags         a collapsed tab: "check the tea bag tubs on the top shelf"; open it to add a packet of
--                    Earl Grey, English Breakfast, Chamomile, Green or Peppermint
--   Coffee machine   the sugar container (still a "Needs refill" task from the upstairs cupboard)
--
-- * Everything except the sugar is staff-entered and collected from the Alcohol storeroom (the coffee
--   beans and hot chocolate move there from Dry storage).
-- * "Lemon Lime Cordial" is renamed "Lime Cordial" (same record and history) and "Lemon Cordial" is added.
-- * Existing products with the same name are reused, never duplicated.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  alc uuid := (select id from storage_locations where lower(name) = 'alcohol storeroom');
  coffee uuid; tea uuid; machine uuid; p uuid; cat uuid; i int; area uuid;
  -- name, unit (one), unit (more), category, where ('o' cupboard, 't' tea bags tab), heading
  list text[][] := array[
    ['Coffee Beans', 'bag', 'bags', 'Coffee & Cordial', 'o', 'Top shelf'],
    ['Hot Chocolate Powder', 'bag', 'bags', 'Coffee & Cordial', 'o', ''],
    ['Decaf Coffee', 'bag', 'bags', 'Coffee & Cordial', 'o', ''],
    ['Chai Powder', 'bag', 'bags', 'Coffee & Cordial', 'o', ''],
    ['Matcha Powder', 'bag', 'bags', 'Coffee & Cordial', 'o', ''],
    ['Biscoff Biscuits', 'packet', 'packets', 'Coffee & Cordial', 'o', ''],
    ['Lemon Cordial', 'bottle', 'bottles', 'Coffee & Cordial', 'o', 'Bottom shelf'],
    ['Lime Cordial', 'bottle', 'bottles', 'Coffee & Cordial', 'o', ''],
    ['Raspberry Cordial', 'bottle', 'bottles', 'Coffee & Cordial', 'o', ''],
    ['Bitters', 'bottle', 'bottles', 'Coffee & Cordial', 'o', ''],
    ['Orange Bitters', 'bottle', 'bottles', 'Coffee & Cordial', 'o', ''],
    ['Honey', 'bottle', 'bottles', 'Coffee & Cordial', 'o', ''],
    ['Hazelnut Syrup', 'bottle', 'bottles', 'Syrups', 'o', ''],
    ['Earl Grey Tea Bags', 'packet', 'packets', 'Tea', 't', ''],
    ['English Breakfast Tea Bags', 'packet', 'packets', 'Tea', 't', ''],
    ['Chamomile Tea Bags', 'packet', 'packets', 'Tea', 't', ''],
    ['Green Tea Bags', 'packet', 'packets', 'Tea', 't', ''],
    ['Peppermint Tea Bags', 'packet', 'packets', 'Tea', 't', '']
  ];
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if alc is null then raise exception 'The storeroom "Alcohol storeroom" must exist first'; end if;
  coffee := (select id from check_areas where department_id = dept and active and lower(name) = 'coffee cupboard' and parent_area_id is null limit 1);
  if coffee is null then raise exception 'Run 2026-11-gold-class-bar-back-bench-walk.sql and -foh-lap.sql first (they add the Coffee cupboard)'; end if;

  -- 1. The two tabs inside the Coffee cupboard: Tea bags (collapsed), then Coffee machine (open).
  tea := (select id from check_areas where department_id = dept and lower(name) = 'tea bags' order by active desc limit 1);
  if tea is null then
    insert into check_areas (department_id, name, sort_order) values (dept, 'Tea bags', 1) returning id into tea;
  end if;
  update check_areas set active = true, parent_area_id = coffee, section_mode = 'collapsed', sort_order = 1,
    guide_text = 'Check the tea bag tubs on the top shelf. Add a packet for any tea that''s running low.' where id = tea;
  machine := (select id from check_areas where department_id = dept and lower(name) = 'coffee machine' order by active desc limit 1);
  if machine is null then
    insert into check_areas (department_id, name, sort_order) values (dept, 'Coffee machine', 2) returning id into machine;
  end if;
  update check_areas set active = true, parent_area_id = coffee, section_mode = 'open', sort_order = 2,
    guide_text = 'The sugar container next to the coffee machine.' where id = machine;

  -- 2. Lemon Lime Cordial becomes Lime Cordial (unless there's already a Lime Cordial).
  update products set name = 'Lime Cordial'
    where department_id = dept and lower(name) = 'lemon lime cordial'
      and not exists (select 1 from products where department_id = dept and lower(name) = 'lime cordial');

  -- 3. The shelves and the tea bags.
  for i in 1 .. array_length(list, 1) loop
    insert into categories (department_id, name, sort_order) select dept, list[i][4], 100
      where not exists (select 1 from categories where department_id = dept and lower(name) = lower(list[i][4]));
    cat := (select id from categories where department_id = dept and lower(name) = lower(list[i][4]));
    p := (select id from products where department_id = dept and lower(name) = lower(list[i][1]) order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, list[i][1], list[i][2], list[i][3], 'manual', alc, 940 + i) returning id into p;
    else
      update products set status = 'active', default_location_id = alc, category_id = coalesce(category_id, cat) where id = p;
    end if;
    area := case when list[i][5] = 't' then tea else coffee end;
    -- On the other tab of the cupboard (or the cupboard itself) already: move it rather than add another.
    if not exists (select 1 from product_placements where product_id = p and check_area_id = area) then
      if exists (select 1 from product_placements where product_id = p and check_area_id in (coffee, tea, machine)) then
        update product_placements set check_area_id = area where product_id = p and check_area_id in (coffee, tea, machine);
      else
        insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i);
      end if;
    end if;
    update product_placements set sort_order = i, heading = nullif(list[i][6], ''), par_level = null
      where product_id = p and check_area_id = area;
  end loop;

  -- 4. The sugar container moves to the Coffee machine tab (same record and pickup).
  p := (select id from products where department_id = dept and lower(name) = 'sugar container' and status = 'active' limit 1);
  if p is not null then
    if exists (select 1 from product_placements where product_id = p and check_area_id = machine) then
      delete from product_placements where product_id = p and check_area_id = coffee;
    else
      update product_placements set check_area_id = machine where product_id = p and check_area_id = coffee;
    end if;
    update product_placements set sort_order = 1, heading = null where product_id = p and check_area_id = machine;
  end if;

  update check_areas set guide_text = 'Top shelf, then bottom shelf. Add only what needs topping up.'
    where id = coffee and (trim(coalesce(guide_text, '')) = '' or guide_text like 'The coffee supplies cupboard%' or guide_text like 'The cupboard next to the coffee machine%');
  raise notice 'Coffee cupboard: % on the shelves, % tea bags, % at the coffee machine',
    (select count(*) from product_placements where check_area_id = coffee),
    (select count(*) from product_placements where check_area_id = tea),
    (select count(*) from product_placements where check_area_id = machine);
end $$;
