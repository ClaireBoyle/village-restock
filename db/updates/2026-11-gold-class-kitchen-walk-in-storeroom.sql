-- Gold Class Kitchen: everything in the upstairs walk-in fridge with no storeroom set is collected from the
-- downstairs walk-in fridge (sauces, spare bottles and ingredients, fresh herbs, fresh produce, feta, berries,
-- cornichons, pickled ginger, Mexican rice…), so it's listed there on the collection list instead of under
-- "No storeroom set". Safe to run more than once. Only touches Gold Class Kitchen products with no storeroom at
-- all; a storeroom already chosen (on the product or on one area) is kept. Prepped rows are never collected anyway.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  fridge uuid; down uuid; n int;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  fridge := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'walkinfridge' limit 1);
  down := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfridge%' order by sort_order limit 1);
  if fridge is null or down is null then raise exception 'Walk in fridge (upstairs area) or Walk in fridge(Downstairs) (storeroom) not found'; end if;

  update products q set default_location_id = down
    where q.department_id = dept and q.status = 'active' and q.default_location_id is null
      and exists (select 1 from product_placements x join check_areas c on c.id = x.check_area_id
                  where x.product_id = q.id and (c.id = fridge or c.parent_area_id = fridge) and x.location_id is null and x.prep_task_id is null);
  get diagnostics n = row_count;
  raise notice '% products now collected from %', n, (select name from storage_locations where id = down);
  raise notice 'Still no storeroom (would be "No storeroom set"): %', coalesce((select string_agg(distinct q.name, ', ') from product_placements x join products q on q.id = x.product_id
    where q.department_id = dept and q.status = 'active' and q.default_location_id is null and x.location_id is null and x.prep_task_id is null and x.refill_source is null), 'none');
end $$;
