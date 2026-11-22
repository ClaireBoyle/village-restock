-- Gold Class Kitchen: changes from the kitchen trial. Safe to run more than once. Run AFTER
-- db/migrations/024_collect_reminders.sql and the earlier Gold Class Kitchen scripts. Only touches Gold Class Kitchen.
-- Existing products and rows are reused, never duplicated. Applies to Full Restock and Quick Restock.
--
-- 1. Containers to take downstairs: Beef Patties gets "Take tubs and boxes for the burger patties", shown at the
--    top of the collection list (above the first storeroom) only while patties need collecting from downstairs.
--    Freezer 1 has enough for the task: nothing to collect, so no reminder. No number yet (not confirmed).
-- 2. Avocado (frozen): checked in Freezer 1 (trial: keep 1 spare pack upstairs; compartment to be confirmed),
--    collected from the downstairs walk-in freezer. Spare there: nothing to enter. Spot empty: Add → 1 pack.
--    Sopressa: checked in the upstairs walk-in fridge beside the sour cream (or, while there's no sour cream row,
--    at the end of the fourth shelf, noted "Beside the sour cream"), collected from the downstairs walk-in fridge.
--    Staff enter the amount; no target.
-- 3. Pizza cheese: the prepared "Portioned Napoli Cheese" (or "Portioned Pizza Cheese mix") becomes
--    "Pizza cheese (portioned bags)", counted in bags.
--    * Defrosted bags: the fourth shelf of the upstairs walk-in fridge (its existing row). What's needed there is
--      one pickup from Freezer 2: "Lower-right compartment, beside the zucchini wedges". Defrosting is optional.
--    * Frozen bags: Freezer 2 → Check remaining spare stock, just after the zucchini wedges. Never collected:
--      "Add prep" → "✓ Needs prep" puts "Portion pizza cheese into bags and freeze" on the next morning's handover.
--    * Smoky Mozzarella, Frozen Cheeses and any bulk Napoli / mozzarella tub products are left as they are.
-- 4. Prep checklist: "Portion pizza cheese into bags and freeze" (group: Portion cheese), quantity-free.
--    No day-dot duration (to be confirmed).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  f1 uuid; f2spare uuid; fridge uuid; fourth uuid; downFreezer uuid; downFridge uuid; f2loc uuid;
  p uuid; pl uuid; t uuid; sc uuid; at int; zsort int; checklist boolean;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'collect_reminder') then
    raise exception 'Run db/migrations/024_collect_reminders.sql first';
  end if;
  checklist := exists (select 1 from information_schema.columns where table_name = 'prep_tasks' and column_name = 'on_checklist');
  f1 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer1' limit 1);
  f2spare := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Check remaining spare stock') limit 1);
  fridge := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'walkinfridge' limit 1);
  fourth := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · Fourth shelf') limit 1);
  if f1 is null or f2spare is null or fridge is null or fourth is null then
    raise exception 'Run the earlier Gold Class Kitchen scripts first (…-freezers, …-refills, …-walk-in-third-shelf)';
  end if;
  downFreezer := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfreezer%' order by sort_order limit 1);
  downFridge := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfridge%' order by sort_order limit 1);
  f2loc := (select id from storage_locations where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer2' order by active desc, sort_order limit 1);
  if f2loc is null then
    insert into storage_locations (name, sort_order)
      values ('Freezer 2', coalesce((select sort_order + 1 from storage_locations where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer1' limit 1),
                                    (select max(sort_order) + 1 from storage_locations), 1)) returning id into f2loc;
  end if;
  update storage_locations set active = true where id = f2loc and not active;

  -- 1. Beef patties: the containers to take down (only when they're on the collection list).
  update products set collect_reminder = 'Take tubs and boxes for the burger patties'
    where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('beefpatties', 'beefburgerpatties', 'burgerpatties')
      and coalesce(trim(collect_reminder), '') = '';

  -- 2a. Avocado (frozen): Freezer 1 (compartment to be confirmed), from the downstairs walk-in freezer.
  p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('avocadofrozen', 'frozenavocado')
        order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, 'Avocado (frozen)', 'pack', 'packs', 'manual', downFreezer, (select coalesce(max(sort_order), 0) + 1 from products where department_id = dept)) returning id into p;
  else
    update products set status = 'active', default_location_id = coalesce(default_location_id, downFreezer) where id = p;
  end if;
  pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id where x.product_id = p and (c.id = f1 or c.parent_area_id = f1) limit 1);
  if pl is null then
    insert into product_placements (product_id, check_area_id, sort_order, instructions)
      values (p, f1, (select coalesce(max(sort_order), 0) + 1 from product_placements where check_area_id = f1),
              'Trial: keep 1 spare pack here. Compartment to be confirmed') returning id into pl;
  end if;
  update product_placements set par_level = null, prep_task_id = null where id = pl;

  -- 2b. Sopressa: beside the sour cream in the upstairs walk-in fridge, from the downstairs walk-in fridge.
  p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('sopressa', 'soppressa')
        order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
      values (dept, 'Sopressa', 'pack', 'packs', 'manual', downFridge, (select coalesce(max(sort_order), 0) + 1 from products where department_id = dept)) returning id into p;
  else
    update products set status = 'active', default_location_id = coalesce(default_location_id, downFridge) where id = p;
  end if;
  -- The sour cream's row, if there is one.
  sc := (select x.id from product_placements x join products q on q.id = x.product_id join check_areas c on c.id = x.check_area_id
         where q.department_id = dept and q.status = 'active' and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') like '%sourcream%'
           and (c.id = fridge or c.parent_area_id = fridge) order by c.sort_order, x.sort_order limit 1);
  pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id where x.product_id = p and (c.id = fridge or c.parent_area_id = fridge) limit 1);
  if pl is null then
    if sc is not null then
      -- Straight after the sour cream (the rows after it move down one).
      select check_area_id, sort_order into fourth, at from product_placements where id = sc;
      update product_placements set sort_order = sort_order + 1 where check_area_id = fourth and sort_order > at;
      insert into product_placements (product_id, check_area_id, sort_order) values (p, fourth, at + 1) returning id into pl;
    else
      insert into product_placements (product_id, check_area_id, sort_order, instructions)
        values (p, fourth, (select coalesce(max(sort_order), 0) + 1 from product_placements where check_area_id = fourth), 'Beside the sour cream') returning id into pl;
    end if;
  end if;
  update product_placements set par_level = null, prep_task_id = null where id = pl;
  fourth := (select id from check_areas where department_id = dept and lower(name) = lower('Walk in fridge · Fourth shelf') limit 1);

  -- 3. Pizza cheese (portioned bags): Napoli and regular mozzarella portioned together, frozen in bags.
  p := (select id from products where department_id = dept
          and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('pizzacheeseportionedbags', 'portionedpizzacheesemix', 'portionednapolicheese', 'portionedpizzacheese')
        order by (status = 'active') desc,
          (regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'pizzacheeseportionedbags') desc, created_at limit 1);
  -- The task (on the morning handover and the Prep checklist; quantity-free).
  t := (select id from prep_tasks where department_id = dept and lower(name) = lower('Portion pizza cheese into bags and freeze'));
  if t is null then
    insert into prep_tasks (department_id, grp, name, sort_order)
      values (dept, 'other', 'Portion pizza cheese into bags and freeze', coalesce((select max(sort_order) from prep_tasks where department_id = dept), 0) + 1) returning id into t;
  end if;
  update prep_tasks set active = true where id = t;
  if checklist then
    execute 'update prep_tasks set on_checklist = true, checklist_group = coalesce(checklist_group, $2), checklist_name = coalesce(checklist_name, $3) where id = $1'
      using t, 'Portion cheese', 'Portion pizza cheese into bags and freeze';
  end if;

  if p is null then
    raise notice 'No "Portioned Napoli Cheese" / "Portioned Pizza Cheese mix" product found: pizza cheese not changed';
  else
    update products set name = 'Pizza cheese (portioned bags)', unit_singular = 'bag', unit_plural = 'bags', status = 'active', method = 'manual'
      where id = p;
    -- Defrosted bags: its walk-in fridge row (the fourth shelf if it has none), one pickup from Freezer 2.
    pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
           where x.product_id = p and (c.id = fridge or c.parent_area_id = fridge) order by (c.id = fourth) desc limit 1);
    if pl is null then
      insert into product_placements (product_id, check_area_id, sort_order) values (p, fourth, (select coalesce(max(sort_order), 0) + 1 from product_placements where check_area_id = fourth)) returning id into pl;
    end if;
    update product_placements set location_id = f2loc, prep_task_id = null, par_level = null, pickup_area_id = null,
      collect_note = 'Lower-right compartment, beside the zucchini wedges',
      instructions = case when coalesce(trim(instructions), '') in ('', 'Pizza cheese', 'Portioned', 'Prepared portions')
                          then 'Defrosted bags (optional: frozen bags can be used straight from Freezer 2)' else instructions end,
      unit_singular = null, unit_plural = null
      where id = pl;
    -- Frozen bags: Freezer 2, just after the zucchini wedges. A prep check, never collected.
    pl := (select id from product_placements where product_id = p and check_area_id = f2spare limit 1);
    if pl is null then
      zsort := (select x.sort_order from product_placements x join products q on q.id = x.product_id
                where x.check_area_id = f2spare and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') like 'zucchiniwedge%' limit 1);
      if zsort is null then
        zsort := (select coalesce(max(sort_order), 0) from product_placements where check_area_id = f2spare);
      end if;
      update product_placements set sort_order = sort_order + 1 where check_area_id = f2spare and sort_order > zsort;
      insert into product_placements (product_id, check_area_id, sort_order) values (p, f2spare, zsort + 1) returning id into pl;
    end if;
    update product_placements set prep_task_id = t, location_id = null, par_level = null, pickup_area_id = null, heading = null,
      instructions = case when coalesce(trim(instructions), '') = '' then 'Frozen bags, lower right beside the zucchini wedges' else instructions end
      where id = pl;
  end if;

  raise notice 'Take with you: %', coalesce((select string_agg(name || ': ' || collect_reminder, '; ') from products where department_id = dept and status = 'active' and collect_reminder is not null), 'none');
  raise notice 'Freezer 1: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = f1);
  raise notice 'Fourth shelf: %', (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = fourth);
  raise notice 'Freezer 2 spare stock: %', (select string_agg(q.name || case when x.prep_task_id is not null then ' (prep)' else '' end, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = f2spare);
end $$;
