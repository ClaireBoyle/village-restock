-- Gold Class Kitchen Prep checklist: the confirmed jobs, grouped so staff check one shelf at a time.
-- Safe to run more than once. Run AFTER db/migrations/021_prep_checklist.sql and the earlier Gold Class Kitchen
-- scripts. Only touches Gold Class Kitchen. Uses the same tasks as the morning handover (Admin → Morning prep).
--
--   Portion sauces              BBQ sauce, Sweet chilli sauce, Tomato sauce
--   Make sauces                 Vodka sauce, Sriracha mayo, Burger sauce, Hollandaise dressing, Tartare, Maple aioli, Sesame mayo
--   Cut veg for Harvest Hommus  Carrot, Cucumber, Celery, Radish
--   Portion proteins            Defrosted pulled beef for bao buns
--
-- Portioned lamb, cauliflower popcorn and Fisherman's Baskets stay on the morning handover (from the Freezer 2
-- portioning check) but aren't on the checklist yet: switch them on in Admin → Morning prep if wanted.
-- The task order is kept as it is (reorder in Admin → Morning prep).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  i int; t uuid; n int := 0;
  -- task name, group, name on the checklist
  list text[][] := array[
    ['Portion BBQ sauce', 'Portion sauces', 'BBQ sauce'],
    ['Portion sweet chilli sauce', 'Portion sauces', 'Sweet chilli sauce'],
    ['Portion tomato sauce', 'Portion sauces', 'Tomato sauce'],
    ['Make vodka sauce', 'Make sauces', 'Vodka sauce'],
    ['Make sriracha mayo', 'Make sauces', 'Sriracha mayo'],
    ['Make burger sauce', 'Make sauces', 'Burger sauce'],
    ['Make hollandaise dressing', 'Make sauces', 'Hollandaise dressing'],
    ['Make tartare', 'Make sauces', 'Tartare'],
    ['Make maple aioli', 'Make sauces', 'Maple aioli'],
    ['Make sesame mayo', 'Make sauces', 'Sesame mayo'],
    ['Cut carrots for Harvest Hommus', 'Cut veg for Harvest Hommus', 'Carrot'],
    ['Cut cucumber for Harvest Hommus', 'Cut veg for Harvest Hommus', 'Cucumber'],
    ['Cut celery for Harvest Hommus', 'Cut veg for Harvest Hommus', 'Celery'],
    ['Cut radish for Harvest Hommus', 'Cut veg for Harvest Hommus', 'Radish'],
    ['Portion defrosted pulled beef', 'Portion proteins', 'Defrosted pulled beef for bao buns']
  ];
  grp text;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'prep_tasks' and column_name = 'on_checklist') then
    raise exception 'Run db/migrations/021_prep_checklist.sql first';
  end if;
  for i in 1 .. array_length(list, 1) loop
    t := (select id from prep_tasks where department_id = dept and lower(name) = lower(list[i][1]) limit 1);
    grp := case when list[i][2] like '%sauces' then 'sauces' when list[i][2] like 'Cut veg%' then 'vegetables' else 'proteins' end;
    if t is null then
      -- Missing (e.g. renamed in Admin): added at the end of the list.
      insert into prep_tasks (department_id, grp, name, sort_order)
        values (dept, grp, list[i][1], (select coalesce(max(sort_order), 0) + 1 from prep_tasks where department_id = dept)) returning id into t;
    end if;
    update prep_tasks set checklist_group = list[i][2], checklist_name = list[i][3], on_checklist = true where id = t;
    n := n + 1;
  end loop;
  -- Only the confirmed jobs on the checklist for now.
  update prep_tasks set on_checklist = false
    where department_id = dept and lower(name) in ('portion lamb', 'portion cauliflower popcorn', 'portion fisherman''s baskets');
  raise notice 'Prep checklist: % jobs in % groups', n,
    (select count(distinct checklist_group) from prep_tasks where department_id = dept and on_checklist and active);
end $$;
