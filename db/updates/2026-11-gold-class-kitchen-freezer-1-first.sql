-- Gold Class Kitchen: Freezer 1 before Freezer 2. Safe to run more than once. Run AFTER
-- 2026-11-gold-class-kitchen-refills.sql (and the earlier Gold Class Kitchen scripts). Only touches Gold Class Kitchen.
--
--   Defrost → Freezer 1 → Freezer 2 → Chest freezer → Walk in fridge → Dry stock
--
-- Only the order changes (same products, compartments, refills and pickups). The Defrost pull list follows it
-- (Freezer 1, then Freezer 2). Freezer 1's guide no longer says "after refilling Freezer 2" (left alone if a
-- manager has written their own).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  defrost uuid; f1 uuid; f2 uuid; chest uuid; walk uuid; a uuid; k int := 0;
  norm text := '[^a-z0-9]';
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  defrost := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'defrost' limit 1);
  f1 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), norm, '', 'g') = 'freezer1' limit 1);
  f2 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), norm, '', 'g') = 'freezer2' limit 1);
  chest := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), norm, '', 'g') = 'chestfreezer' limit 1);
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), norm, '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  if f1 is null or f2 is null then raise notice 'Freezer 1 or Freezer 2 not found: nothing changed'; return; end if;

  for a in select x from unnest(array[defrost, f1, f2, chest, walk]) x where x is not null loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;
  for a in select id from check_areas where department_id = dept and parent_area_id is null and not (id = any(array[defrost, f1, f2, chest, walk])) order by active desc, sort_order loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;

  update check_areas set guide_text = 'Check the overflow stock here and enter the total needed from downstairs. What was pulled for defrost is suggested at the top.'
    where id = f1 and guide_text like 'After refilling Freezer 2:%';

  raise notice 'Gold Class Kitchen: %', (select string_agg(name, ' → ' order by sort_order) from check_areas where department_id = dept and active and parent_area_id is null);
end $$;
