-- Gold Class Kitchen: portioned lamb, cauliflower popcorn and Fisherman's Baskets are portioned in
-- morning prep, not refilled. Safe to run more than once. Run AFTER 2026-11-gold-class-kitchen-refills.sql.
-- Only touches Gold Class Kitchen.
--
-- * Off Freezer 2's "Refill working drawers and tubs" (the same rows move, never copied) and into
--   "Check remaining spare stock" under "Portioned in morning prep": an amount entered there adds its
--   portion task to the morning prep handover (never the collection list).
-- * Morning prep checklist: Portion cauliflower popcorn (Vegetables), Portion lamb and Portion
--   Fisherman's Baskets (Proteins).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  refill uuid; spare uuid; p uuid; pl uuid; t uuid; i int; n int; norm text; first boolean := true;
  -- product, task, group
  list text[][] := array[
    ['Portioned Lamb', 'Portion lamb', 'proteins'],
    ['Cauliflower Popcorn', 'Portion cauliflower popcorn', 'vegetables'],
    ['Fisherman''s Basket', 'Portion Fisherman''s Baskets', 'proteins']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if to_regclass('public.prep_tasks') is null then raise exception 'Run db/migrations/017_morning_prep.sql first'; end if;
  refill := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Refill working drawers and tubs'));
  spare := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Check remaining spare stock'));
  if refill is null or spare is null then raise exception 'Run 2026-11-gold-class-kitchen-refills.sql first'; end if;

  for i in 1 .. array_length(list, 1) loop
    -- The portion task (after the others in its group).
    t := (select id from prep_tasks where department_id = dept and lower(name) = lower(list[i][2]));
    if t is null then
      insert into prep_tasks (department_id, grp, name, sort_order)
        values (dept, list[i][3], list[i][2], coalesce((select max(sort_order) from prep_tasks where department_id = dept), 0) + 1) returning id into t;
    else
      update prep_tasks set active = true, grp = list[i][3] where id = t;
    end if;

    norm := regexp_replace(lower(list[i][1]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm order by created_at limit 1);
    if p is null then continue; end if;
    -- The refill row becomes the spare-stock row (or goes, if that product is already there).
    pl := (select id from product_placements where product_id = p and check_area_id = spare limit 1);
    if pl is null then
      -- From the refill section, or still in one of Freezer 2's old compartments.
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and (c.id = refill or (c.parent_area_id = (select parent_area_id from check_areas where id = spare) and c.id <> spare))
             order by (c.id = refill) desc limit 1);
      if pl is null then insert into product_placements (product_id, check_area_id, sort_order) values (p, spare, 900) returning id into pl;
      else update product_placements set check_area_id = spare where id = pl; end if;
    end if;
    -- Never twice in Freezer 2.
    delete from product_placements x using check_areas c where c.id = x.check_area_id and x.product_id = p and x.id <> pl
      and (c.id = refill or (c.parent_area_id = (select parent_area_id from check_areas where id = spare) and c.id <> spare));
    n := coalesce((select max(sort_order) from product_placements where check_area_id = spare and id <> pl and prep_task_id is null), 0) + i;
    -- Portioned in prep: no refill, no collection source.
    update product_placements set refill_source = null, pickup_area_id = null, pickup_suggest = false, par_level = null, location_id = null,
      prep_task_id = t, sort_order = n, heading = case when i = 1 then 'Portioned in morning prep' else null end,
      instructions = case when instructions = 'Prepared portions' then null else instructions end
      where id = pl;
  end loop;

  -- Freezer 2's old compartments, once empty, are switched off (kept for history).
  update check_areas c set active = false where c.parent_area_id = (select parent_area_id from check_areas where id = spare)
    and c.id not in (refill, spare) and not exists (select 1 from product_placements x where x.check_area_id = c.id);

  raise notice 'Freezer 2: % refills; portioned in morning prep: %; morning prep checklist: % tasks',
    (select count(*) from product_placements where check_area_id = refill),
    (select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id where x.check_area_id = spare and x.prep_task_id is not null),
    (select count(*) from prep_tasks where department_id = dept and active);
end $$;
