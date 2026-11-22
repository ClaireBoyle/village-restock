-- Gold Class Kitchen: desserts only on Defrost, not again in the walk-in fridge. Safe to run more than once.
-- Run AFTER the earlier Gold Class Kitchen scripts. Only touches Gold Class Kitchen.
--
-- The walk-in fridge's "Dessert shelf" listed the same 9 desserts as Defrost (Basque Cheesecake … Sticky Date).
-- It's taken off the restock: its rows are removed and the section is hidden. Defrost still plans them, and they
-- still go to the upstairs walk-in fridge's dessert shelf (that's only where they're put). Past restocks keep
-- their records. The burger buns on the right rack are left as they are.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  shelf uuid; n int;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  shelf := (select c.id from check_areas c join check_areas w on w.id = c.parent_area_id
            where c.department_id = dept and lower(c.name) = lower('Walk in fridge · Dessert shelf') limit 1);
  if shelf is null then raise notice 'No walk-in dessert shelf: nothing to change'; return; end if;
  delete from product_placements where check_area_id = shelf;
  get diagnostics n = row_count;
  update check_areas set active = false where id = shelf;
  raise notice 'Walk-in dessert shelf removed (% rows). Desserts are on Defrost only.', n;
end $$;
