-- Gold Class Bar: the FOH beer fridge is its own stop, the last one on "Check the bar", straight before
-- the BOH bar fridge (where its beers are grabbed from). Safe to run more than once. Only touches Gold Class Bar.
-- Run AFTER 2026-11-gold-class-bar-foh-lap.sql (and, if it was run, …-bench-fridge-stop.sql).
--
-- Check the bar: FOH freezer → Confection → Popcorn boxes → Back bench → Back shelves → Milkshake station →
-- Cups, Lids & Straws → Coffee cupboard → FOH beer fridge; then Upstairs: BOH bar fridge → Walk in fridge →
-- Upstairs cupboards. Same products, pickups and units: only where the fridge is shown changes.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  fridge uuid; boh uuid; k int := 0; a uuid;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  fridge := (select id from check_areas where department_id = dept and active and lower(name) in ('foh beer fridge', 'foh bar fridge') order by sort_order limit 1);
  boh := (select id from check_areas where department_id = dept and active and lower(name) = 'boh bar fridge' and parent_area_id is null limit 1);
  if fridge is null then raise notice 'FOH beer fridge not found: nothing changed'; return; end if;

  -- Its own area again (not a section of the Back bench).
  update check_areas set parent_area_id = null, section_mode = 'open',
    guide_text = case when trim(coalesce(guide_text, '')) = '' or guide_text like 'Enter the single bottles needed%' or guide_text like 'Single bottles and cans.%'
                      then 'Single bottles and cans. Beers and mixers are grabbed from the BOH bar fridge next; Curatif comes from downstairs.'
                      else guide_text end
    where id = fridge;

  -- Top-level areas in order, with the fridge straight before the BOH bar fridge (or last if there isn't one).
  for a in select id from check_areas where department_id = dept and parent_area_id is null and id <> fridge order by active desc, sort_order, name loop
    if a = boh then k := k + 1; update check_areas set sort_order = k where id = fridge; end if;
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;
  if boh is null then update check_areas set sort_order = k + 1 where id = fridge; end if;

  raise notice 'Gold Class Bar: %', (select string_agg(name, ' → ' order by sort_order) from check_areas where department_id = dept and active and parent_area_id is null);
end $$;
