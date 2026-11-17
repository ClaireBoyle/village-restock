-- Gold Class Bar closing flow: FOH first, then the upstairs cupboards. Safe to run more than once.
--
--   Back bench, Back shelves:  enter what FOH needs. Where it's also kept in an upstairs cupboard, grab it
--                              from there (the row says which cupboard). Everything entered goes on the
--                              downstairs list: to refill the cupboard, or straight to FOH for items that are
--                              only kept on the bench or downstairs (e.g. syrups).
--   Upstairs cupboards:        one screen with two sections, Wine cupboard and Spirits cupboard.
--                              Add only EXTRA stock a cupboard needs (e.g. taken earlier in the shift);
--                              each row shows what's already on the list for FOH ("Already 1 for Back bench").
--
-- The same products are used everywhere, so the downstairs list has one line per product with the
-- amounts added up. Products, ids, photos, order and the cupboards' own subheadings are kept.
-- Short instructions are only written where an area has none yet.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  bench uuid; shelves uuid; wine uuid; spirits uuid; up uuid; s int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'check_areas' and column_name = 'parent_area_id') then
    raise exception 'Run db/migrations/008_area_sections.sql first';
  end if;
  bench := (select id from check_areas where department_id = dept and lower(name) = 'back bench' and active);
  shelves := (select id from check_areas where department_id = dept and lower(name) = 'back shelves' and active);
  wine := (select id from check_areas where department_id = dept and lower(name) = 'wine cupboard' and active);
  spirits := (select id from check_areas where department_id = dept and lower(name) = 'spirits cupboard' and active);
  if wine is null and spirits is null then raise notice 'No upstairs cupboards found: nothing changed'; return; end if;

  -- 1. The "Upstairs cupboards" screen, right after the back bar (Back shelves, or the Back bench).
  up := (select id from check_areas where department_id = dept and lower(name) = 'upstairs cupboards');
  if up is null then
    s := coalesce((select sort_order from check_areas where id = coalesce(shelves, bench)), 0);
    update check_areas set sort_order = sort_order + 1 where department_id = dept and sort_order > s;
    insert into check_areas (department_id, name, sort_order) values (dept, 'Upstairs cupboards', s + 1) returning id into up;
  end if;
  update check_areas set active = true, parent_area_id = null where id = up;
  update check_areas set guide_text = 'Add only extra stock the cupboards need. What you took for the back bar is already on the list.'
    where id = up and trim(guide_text) = '';

  -- 2. Both cupboards become (open) sections of it: Wine cupboard first, then Spirits cupboard.
  update check_areas set parent_area_id = up, section_mode = 'open', sort_order = 1 where id = wine;
  update check_areas set parent_area_id = up, section_mode = 'open', sort_order = 2 where id = spirits;

  -- 3. The back bar says where FOH stock comes from (only if it has no instruction yet).
  update check_areas set guide_text = 'Use the upstairs cupboards first where there''s stock. Everything you enter goes on the downstairs list.'
    where id in (bench, shelves) and (trim(guide_text) = '' or guide_text = 'Grab what''s needed from the upstairs cupboards. It goes on the downstairs list automatically.');
  raise notice 'Upstairs cupboards set up';
end $$;
