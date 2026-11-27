-- Gold Class Kitchen Prep checklist: the pulled beef job is "Bao meat portioning" under "Portion bao"
-- (was "Defrosted pulled beef for bao buns" under "Portion proteins"). Safe to run more than once.
-- Only the name and group on the Prep checklist change; the morning handover keeps the task's own name.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  n int;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  update prep_tasks set checklist_group = 'Portion bao', checklist_name = 'Bao meat portioning'
    where department_id = dept
      and (lower(name) = 'portion defrosted pulled beef' or checklist_name = 'Defrosted pulled beef for bao buns');
  get diagnostics n = row_count;
  raise notice 'Portion bao: % job updated (%)', n, coalesce((select string_agg(checklist_group || ' · ' || checklist_name, ', ')
    from prep_tasks where department_id = dept and checklist_group = 'Portion bao'), 'none found');
end $$;
