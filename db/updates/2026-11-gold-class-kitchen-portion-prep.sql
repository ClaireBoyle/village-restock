-- Gold Class Kitchen: portioned lamb, cauliflower popcorn and Fisherman's Baskets are Freezer 1 stock,
-- and portioning them is a morning prep task. Safe to run more than once (run it again to put back a portioning
-- check that was changed, e.g. after "Portioned Lamb" was renamed "Lamb"). Run AFTER
-- 2026-11-gold-class-kitchen-refills.sql. Only touches Gold Class Kitchen.
--
-- * Freezer 2: no refill or spare stock row. Instead, at the end of "Refill working drawers and tubs",
--   under "Check the portioning": while refilling, staff tick "Needs portioning" and the portion task
--   goes on the next morning's prep handover (nothing is added to the restock).
-- * In Freezer 1 (lamb and cauliflower popcorn in the lower right, Fisherman's Baskets with their spares):
--   staff check the stock level there and enter what's needed from downstairs, as usual (collected
--   from the downstairs walk-in freezer).
-- * Morning prep checklist: Portion cauliflower popcorn (Vegetables), Portion lamb and Portion
--   Fisherman's Baskets (Proteins), chosen by staff when needed (a stock amount doesn't add them).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  f1 uuid; f2 uuid; area uuid; p uuid; pl uuid; t uuid; i int; norm text; down uuid; refill uuid; chk uuid; fresh boolean;
  -- product (or its other names, split by |), Freezer 1 section, task, group, note beside it
  list text[][] := array[
    ['Portioned Lamb|Lamb', 'Freezer 1 · Lower right', 'Portion lamb', 'proteins', 'Overflow'],
    ['Cauliflower Popcorn', 'Freezer 1 · Lower right', 'Portion cauliflower popcorn', 'vegetables', 'Overflow'],
    ['Fisherman''s Basket', 'Freezer 1 · Fisherman''s Basket spares', 'Portion Fisherman''s Baskets', 'proteins', 'Prepared portions']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if to_regclass('public.prep_tasks') is null then raise exception 'Run db/migrations/017_morning_prep.sql first'; end if;
  f1 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer1' limit 1);
  f2 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer2' limit 1);
  if f1 is null or f2 is null then raise exception 'Run the earlier Gold Class Kitchen scripts first (…-freezers, …-refills)'; end if;
  refill := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Refill working drawers and tubs'));
  if refill is null then raise exception 'Run 2026-11-gold-class-kitchen-refills.sql first'; end if;
  down := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfreezer%' order by sort_order limit 1);

  for i in 1 .. array_length(list, 1) loop
    -- The portion task (after the others).
    t := (select id from prep_tasks where department_id = dept and lower(name) = lower(list[i][3]));
    if t is null then
      insert into prep_tasks (department_id, grp, name, sort_order)
        values (dept, list[i][4], list[i][3], coalesce((select max(sort_order) from prep_tasks where department_id = dept), 0) + 1) returning id into t;
    else
      update prep_tasks set active = true, grp = list[i][4] where id = t;
    end if;

    -- Renamed in Admin (e.g. "Portioned Lamb" → "Lamb")? Still found.
    p := (select id from products where department_id = dept and status = 'active'
          and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = any(array(select regexp_replace(lower(x), '[^a-z0-9]', '', 'g') from unnest(string_to_array(list[i][1], '|')) x))
          order by created_at limit 1);
    area := (select id from check_areas where department_id = dept and lower(name) = lower(list[i][2]));
    if p is null or area is null then continue; end if;

    -- In Freezer 1 (its existing row, or moved from Freezer 2, or new).
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null then
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and (c.id = f2 or c.parent_area_id = f2) limit 1);
      if pl is not null then update product_placements set check_area_id = area, sort_order = 0 where id = pl;
      else insert into product_placements (product_id, check_area_id, sort_order) values (p, area, 0) returning id into pl; end if;
    end if;
    -- Freezer 2: one portioning check in the refill section (the old refill or spare row is reused), nothing else.
    chk := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
            where x.product_id = p and x.id <> pl and (c.id = f2 or c.parent_area_id = f2) order by (c.id = refill) desc limit 1);
    fresh := chk is null or not exists (select 1 from product_placements where id = chk and check_area_id = refill);
    if chk is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, refill, 100 + i) returning id into chk;
    else update product_placements set check_area_id = refill where id = chk; end if;
    delete from product_placements x using check_areas c where c.id = x.check_area_id and x.product_id = p and x.id not in (pl, chk) and (c.id = f2 or c.parent_area_id = f2);
    -- Placed among the drawers already (e.g. 2026-11-gold-class-kitchen-portioning-in-drawers.sql): kept there.
    update product_placements set sort_order = case when fresh then 100 + i else sort_order end,
      heading = case when not fresh then heading when i = 1 then 'Check the portioning' else null end, par_level = null,
      refill_source = 'Tick if more needs portioning tomorrow (from the Freezer 1 stock)', prep_task_id = t,
      pickup_area_id = null, pickup_suggest = false, location_id = null, instructions = null
      where id = chk;
    -- Ordinary Freezer 1 stock: check the level, enter what's needed from the downstairs walk-in freezer.
    update product_placements set refill_source = null, pickup_area_id = null, pickup_suggest = false, par_level = null,
      location_id = coalesce(location_id, down), prep_task_id = null, heading = null,
      instructions = case when coalesce(trim(instructions), '') in ('', 'Overflow', 'Prepared portions', 'Portioned in morning prep', 'Portioned in morning prep, from the spares below',
                                                               'Prepared portions. Make more from the spare potato cakes, calamari and onion rings in Freezer 1.') then list[i][5] else instructions end
      where id = pl;
  end loop;

  -- Freezer 2's old compartments, once empty, are switched off (kept for history).
  update check_areas c set active = false where c.parent_area_id = f2
    and lower(c.name) in (lower('Freezer 2 · Upper left'), lower('Freezer 2 · Upper right'), lower('Freezer 2 · Lower left'), lower('Freezer 2 · Lower right'))
    and not exists (select 1 from product_placements x where x.check_area_id = c.id);

  raise notice 'Freezer 1 stock (from downstairs): %; Freezer 2: % refills (incl. % portioning checks), % spare stock checks; morning prep checklist: % tasks',
    (select string_agg(q.name, ', ' order by c.sort_order, x.sort_order) from product_placements x join products q on q.id = x.product_id join check_areas c on c.id = x.check_area_id
       where c.parent_area_id = f1 and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') in ('portionedlamb', 'cauliflowerpopcorn', 'fishermansbasket')),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.parent_area_id = f2 and x.refill_source is not null),
    (select count(*) from product_placements where check_area_id = refill and prep_task_id is not null),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where lower(c.name) = lower('Freezer 2 · Check remaining spare stock')),
    (select count(*) from prep_tasks where department_id = dept and active);
end $$;
