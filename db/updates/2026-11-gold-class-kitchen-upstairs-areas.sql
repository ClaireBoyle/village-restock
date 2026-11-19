-- Gold Class Kitchen: the upstairs areas for the Kitchen restock. Safe to run more than once.
-- Run AFTER 2026-11-gold-class-kitchen-defrost.sql. Only touches Gold Class Kitchen.
--
-- The Kitchen restock, in walking order:
--   1 Defrost          (from 2026-11-gold-class-kitchen-defrost.sql)
--   2 Freezer 2        refilled first (see 2026-11-gold-class-kitchen-refills.sql)
--   3 Freezer 1        its overflow checked after refilling
--   4 Walk in fridge   the upstairs walk-in fridge, topped up from the downstairs walk-in fridge
--   5 Dry stock        topped up from Dry storage
--
-- * The areas start empty: add products in Admin → Products (tick the area, and choose the storeroom
--   it's collected from). Any other Kitchen area keeps its place after these.
-- * An area with the same name is reused (and switched back on), never duplicated. Its own
--   instructions are kept; only a blank one gets the short note below.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  a uuid; k int := 0; i int;
  -- name, match (lowercase letters and numbers only), short note for staff
  list text[][] := array[
    ['Freezer 2', 'freezer2', 'Add only what needs topping up. It comes up from the downstairs walk-in freezer.'],
    ['Freezer 1', 'freezer1', 'Add only what needs topping up. It comes up from the downstairs walk-in freezer.'],
    ['Walk in fridge', 'walkinfridge', 'The upstairs walk-in fridge. Add only what needs topping up from the downstairs walk-in fridge.'],
    ['Dry stock', 'drystock', 'Add only what needs topping up. It comes up from Dry storage.']
  ];
  done uuid[] := '{}';
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;

  -- Defrost stays first.
  for a in select id from check_areas where department_id = dept and parent_area_id is null and lower(name) = 'defrost' order by active desc limit 1 loop
    k := k + 1; update check_areas set sort_order = k where id = a; done := done || a;
  end loop;

  for i in 1 .. array_length(list, 1) loop
    a := (select id from check_areas where department_id = dept and not (id = any(done))
          and (regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = list[i][2]
               or regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = list[i][2] || 'upstairs')
          order by active desc, (parent_area_id is null) desc, sort_order limit 1);
    if a is null then
      insert into check_areas (department_id, name, sort_order) values (dept, list[i][1], 0) returning id into a;
    end if;
    k := k + 1;
    update check_areas set active = true, parent_area_id = null, sort_order = k where id = a;
    update check_areas set guide_text = list[i][3] where id = a and trim(coalesce(guide_text, '')) = '';
    done := done || a;
    -- The chest freezer (2026-11-gold-class-kitchen-freezers.sql) stays straight after the freezers.
    if list[i][2] = 'freezer1' then
      for a in select id from check_areas where department_id = dept and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'chestfreezer' limit 1 loop
        k := k + 1; update check_areas set sort_order = k where id = a; done := done || a;
      end loop;
    end if;
  end loop;

  -- Everything else after, in its existing order.
  for a in select id from check_areas where department_id = dept and parent_area_id is null and not (id = any(done)) order by active desc, sort_order loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;

  raise notice 'Gold Class Kitchen areas: %', (select string_agg(name, ' → ' order by sort_order) from check_areas where department_id = dept and active and parent_area_id is null);
end $$;
