-- Gold Class Kitchen: pull defrost stock on the Defrost screen, then top the freezers back up from
-- downstairs. Safe to run more than once. Run AFTER 2026-11-gold-class-kitchen-defrost.sql and
-- 2026-11-gold-class-kitchen-upstairs-areas.sql. Only touches Gold Class Kitchen.
--
--   1 Defrost      staff enter how many to pull (or Not needed), then tick each one off on
--                  "Pull now", freezer by freezer (Got fewer if the freezer didn't have enough).
--   2 Freezer 1    what was actually pulled from Freezer 1 is suggested under "Replace what you
--   3 Freezer 2    pulled" (same for Freezer 2), to bring up from the downstairs walk-in freezer.
--                  Staff keep, change or remove it, and add anything else that looks low.
--   …              the collection list is the downstairs run.
--
-- * Each defrost item is also put in its freezer's area (Freezer 2: grilled chicken; Freezer 1: the
--   rest), collected from the downstairs walk-in freezer. Its Defrost row still says Freezer 1 / 2.
-- * Items already in a freezer area keep their place and settings there.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  defrost uuid; f1a uuid; f2a uuid; f1s uuid; f2s uuid; down uuid; r record; target uuid; n int;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  defrost := (select id from check_areas where department_id = dept and active and lower(name) = 'defrost' and parent_area_id is null limit 1);
  f1a := (select id from check_areas where department_id = dept and active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer1' and parent_area_id is null limit 1);
  f2a := (select id from check_areas where department_id = dept and active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer2' and parent_area_id is null limit 1);
  if defrost is null or f1a is null or f2a is null then
    raise exception 'Run 2026-11-gold-class-kitchen-defrost.sql and 2026-11-gold-class-kitchen-upstairs-areas.sql first';
  end if;
  f1s := (select id from storage_locations where lower(name) = 'freezer 1');
  f2s := (select id from storage_locations where lower(name) = 'freezer 2');
  -- The downstairs walk-in freezer (e.g. "Walk in freezer(Downstairs)").
  down := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfreezer%' order by sort_order limit 1);
  if down is null then raise exception 'The downstairs walk-in freezer storeroom (e.g. "Walk in freezer(Downstairs)") must exist first'; end if;

  for r in select x.id, x.product_id, x.sort_order, coalesce(x.location_id, p.default_location_id) as room
           from product_placements x join products p on p.id = x.product_id and p.status = 'active' and p.method = 'manual'
           where x.check_area_id = defrost order by x.sort_order loop
    -- Only items pulled from Freezer 1 / 2 (desserts come straight from downstairs once
    -- 2026-11-gold-class-kitchen-freezers.sql has run).
    if r.room is distinct from f1s and r.room is distinct from f2s then continue; end if;
    target := case when r.room = f2s then f2a else f1a end;
    -- The Defrost row: pulled from its freezer, and what's pulled is suggested for that freezer
    -- (a compartment set by the freezers script is kept).
    update product_placements set location_id = coalesce(location_id, r.room), pickup_area_id = coalesce(pickup_area_id, target), pickup_suggest = true where id = r.id;
    -- The product itself is collected from downstairs (its freezer-area row uses that).
    update products set default_location_id = down where id = r.product_id and (default_location_id is null or default_location_id in (f1s, f2s));
    -- In its freezer's area too (once).
    if not exists (select 1 from product_placements x join check_areas c on c.id = x.check_area_id
                   where x.product_id = r.product_id and (c.id = target or c.parent_area_id = target)) then
      n := coalesce((select max(sort_order) from product_placements where check_area_id = target), 0) + 1;
      insert into product_placements (product_id, check_area_id, sort_order) values (r.product_id, target, n);
    end if;
  end loop;

  update check_areas set guide_text = 'What was pulled for defrost is suggested at the top. Add anything else that needs topping up from the downstairs walk-in freezer.'
    where id in (f1a, f2a) and (trim(coalesce(guide_text, '')) = '' or guide_text = 'Add only what needs topping up. It comes up from the downstairs walk-in freezer.');

  raise notice 'Defrost pulls: % items in Freezer 1, % in Freezer 2 (topped up from %)',
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.id = f1a or c.parent_area_id = f1a),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.id = f2a or c.parent_area_id = f2a),
    (select name from storage_locations where id = down);
end $$;
