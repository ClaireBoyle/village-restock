-- Gold Class Bar: the FOH bar fridge (beer, mixers & water, Curatif) is part of the Back bench stop,
-- straight after the spirits and red wine on the benchtop, as on the bar map. Run AFTER
-- 2026-11-gold-class-bar-foh-lap.sql. Safe to run more than once. Only touches Gold Class Bar.
--
-- Check the bar then reads: FOH freezer → Confection → Popcorn boxes → Back bench (sink → spirits &
-- red wine, then the FOH bar fridge) → Back shelves → Milkshake station → Cups, Lids & Straws →
-- Coffee cupboard. Same products, pickups and units: only where the fridge is shown changes.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  bench uuid; fridge uuid; k int := 0; a uuid;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  bench := (select id from check_areas where department_id = dept and active and lower(name) = 'back bench' and parent_area_id is null limit 1);
  fridge := (select id from check_areas where department_id = dept and active and lower(name) in ('foh beer fridge', 'foh bar fridge') order by sort_order limit 1);
  if bench is null or fridge is null then raise notice 'Back bench or FOH beer fridge not found: nothing changed'; return; end if;

  update check_areas set parent_area_id = bench, section_mode = 'open', sort_order = 1,
    guide_text = case when guide_text like 'Enter the single bottles needed%' or trim(coalesce(guide_text, '')) = ''
                      then 'Single bottles and cans. They''re grabbed from the BOH bar fridge and the walk-in; Curatif comes from downstairs.'
                      else guide_text end
    where id = fridge;

  -- Renumber the stops (top level only) so there's no gap where the fridge was.
  for a in select id from check_areas where department_id = dept and parent_area_id is null order by active desc, sort_order, name loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;
  raise notice 'Back bench stop now includes the FOH bar fridge (% products)', (select count(*) from product_placements where check_area_id = fridge);
end $$;
