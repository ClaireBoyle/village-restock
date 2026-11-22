-- October 2026 VIC cookbook, House Made. Apply after 021_prep_checklist.sql.
-- Stock locations and par levels are managed separately by the site.
do $$
declare
  kitchen_id uuid;
  job record;
  next_sort integer;
begin
  select id into strict kitchen_id from departments where lower(name) = 'gold class kitchen';
  lock table prep_tasks in share row exclusive mode;
  select coalesce(max(sort_order), 0) + 1 into next_sort
    from prep_tasks where department_id = kitchen_id;

  for job in select * from (values
    ('Make smoky sauerkraut aioli', 'Smoky sauerkraut aioli', 'Make sauces', 'sauces'),
    ('Make sesame XO dumpling sauce', 'Sesame XO dumpling sauce', 'Make sauces', 'sauces'),
    ('Make raspberry compote', 'Raspberry compote', 'Dessert prep', 'other'),
    ('Make signature chip salt', 'Signature chip salt', 'Seasonings', 'other'),
    ('Dice white onion for burgers', 'Diced white onion for burgers', 'Salad bar', 'vegetables'),
    ('Slice cucumber for bao buns', 'Sliced cucumber for bao buns', 'Salad bar', 'vegetables'),
    ('Dice tomato', 'Diced tomato', 'Salad bar', 'vegetables'),
    ('Wash tubs of lettuce', 'Washed lettuce tubs', 'Salad bar', 'vegetables'),
    ('Cut and shred lettuce', 'Cut and shredded lettuce', 'Salad bar', 'vegetables'),
    ('Cut lemon wedges', 'Lemon wedges', 'Salad bar', 'other'),
    ('Cut lime wedges', 'Lime wedges', 'Salad bar', 'other'),
    ('Dice red onion', 'Diced red onion', 'Fridge under salad bar', 'vegetables')
  ) as jobs(task_name, label, section, handover_group)
  loop
    if not exists (
      select 1 from prep_tasks where department_id = kitchen_id
        and (lower(name) in (lower(job.task_name), lower(job.label))
          or lower(checklist_name) = lower(job.label))
    ) then
      insert into prep_tasks
        (department_id, name, grp, sort_order, checklist_group, checklist_name, on_checklist, active)
      values
        (kitchen_id, job.task_name, job.handover_group, next_sort, job.section, job.label, true, true);
      next_sort := next_sort + 1;
    end if;
  end loop;
end $$;
