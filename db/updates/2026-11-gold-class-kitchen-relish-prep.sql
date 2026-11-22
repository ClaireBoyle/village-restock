-- Gold Class Kitchen: Smokey tomato relish is portioned in morning prep, like the other portioned sauces.
-- Safe to run more than once. Run AFTER the earlier Gold Class Kitchen scripts. Only touches Gold Class Kitchen.
--
-- * Second sauce shelf (the portioned relish in use): a prep row, like BBQ sauce. What staff enter there
--   ("Add prep") goes to the morning team as "Portion smokey tomato relish"; it's never collected.
-- * Spare Sauces (lower left shelf): the spare tub stays as stock, collected from its storeroom ("Add"), with a note.
-- * The task "Portion smokey tomato relish" is on the morning handover list and on the Prep checklist under
--   "Portion sauces" (as "Smokey tomato relish"), after the jobs already there.
-- * Every portioned sauce (a sauce whose morning prep task is "Portion …", e.g. tomato, BBQ and sweet chilli
--   sauce, and the relish) is counted in bottles.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  p uuid; t uuid; up uuid; spare uuid; spares uuid;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;

  -- Portioned sauces are counted in bottles.
  update products q set unit_singular = 'bottle', unit_plural = 'bottles'
    where q.department_id = dept and (q.unit_singular, q.unit_plural) is distinct from ('bottle', 'bottles')
      and exists (select 1 from product_placements x join prep_tasks pt on pt.id = x.prep_task_id
                  where x.product_id = q.id and pt.grp = 'sauces' and pt.name ilike 'Portion %');
  raise notice 'Portioned sauces, in bottles: %', (select string_agg(distinct q.name, ', ') from products q join product_placements x on x.product_id = q.id
    join prep_tasks pt on pt.id = x.prep_task_id where q.department_id = dept and pt.grp = 'sauces' and pt.name ilike 'Portion %');

  p := (select id from products where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('smokeytomatorelish', 'smokytomatorelish') order by created_at limit 1);
  if p is null then raise notice 'Smokey tomato relish not found: nothing changed'; return; end if;

  -- The portion task.
  t := (select id from prep_tasks where department_id = dept and lower(name) = lower('Portion smokey tomato relish'));
  if t is null then
    insert into prep_tasks (department_id, grp, name, sort_order)
      values (dept, 'sauces', 'Portion smokey tomato relish', coalesce((select max(sort_order) from prep_tasks where department_id = dept), 0) + 1) returning id into t;
  end if;
  update prep_tasks set active = true where id = t;
  if exists (select 1 from information_schema.columns where table_name = 'prep_tasks' and column_name = 'on_checklist') then
    update prep_tasks set on_checklist = true, checklist_group = coalesce(checklist_group, 'Portion sauces'), checklist_name = coalesce(checklist_name, 'Smokey tomato relish') where id = t;
  end if;

  -- Second sauce shelf: the portioned relish, made in morning prep (no collection source).
  up := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
         where x.product_id = p and c.department_id = dept and lower(c.name) = lower('Walk in fridge · Second sauce shelf') limit 1);
  if up is not null then
    update product_placements set prep_task_id = t, location_id = null,
      instructions = coalesce(nullif(trim(instructions), ''), 'Portioned in morning prep')
      where id = up;
  end if;

  -- The spare tub on the lower spare sauces shelf: ordinary stock to grab.
  spare := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
            where x.product_id = p and c.department_id = dept and x.id <> coalesce(up, '00000000-0000-0000-0000-000000000000'::uuid)
              and c.name ilike 'Walk in fridge · %spare sauces%' limit 1);
  if spare is not null then
    update product_placements set prep_task_id = null, instructions = coalesce(nullif(trim(instructions), ''), 'Spare tub, for portioning') where id = spare;
    spares := (select check_area_id from product_placements where id = spare);
    -- Its shelf note no longer says everything there is made in prep.
    update check_areas set guide_text = 'Spare sauce tubs. Vodka sauce and maple aioli are made in morning prep (Add prep); the relish spare tub is stock (Add).'
      where id = spares and guide_text like '%Made in morning prep: what you enter goes to the morning team.';
  end if;

  raise notice 'Smokey tomato relish: second sauce shelf %, spare tub %; task "Portion smokey tomato relish"',
    case when up is null then 'not found' else 'portioned in morning prep' end, case when spare is null then 'not found' else 'stock' end;
end $$;
