-- Gold Class Kitchen → Freezer 2 → Refill working drawers and tubs: the portioning checks (Needs portioning) back in
-- drawer order, as the freezer is laid out, instead of a separate "Check the portioning" group at the end:
--   Lamb                  first (upper left, before the Chicken Tenders drawer)
--   Fisherman's Basket    after Prawn Twisters (the first of the upper right)
--   Cauliflower Popcorn   after Fish (before Carrot Pieces)
-- Safe to run more than once. Only these three rows move (into a free spot, or the rows after move down one).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  refill uuid; i int; pl uuid; s int;
  -- the portioning check (product, any of its names | ), the drawer it goes after ('' = first)
  list text[][] := array[
    ['portionedlamb|lamb', ''],
    ['fishermansbasket|fishermansbaskets', 'prawntwisters'],
    ['cauliflowerpopcorn', 'fish']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  refill := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Refill working drawers and tubs') limit 1);
  if refill is null then raise notice 'Freezer 2 · Refill working drawers and tubs not found: nothing changed'; return; end if;

  for i in 1 .. array_length(list, 1) loop
    pl := (select x.id from product_placements x join products q on q.id = x.product_id
           where x.check_area_id = refill and x.prep_task_id is not null
             and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = any(string_to_array(list[i][1], '|')) limit 1);
    if pl is null then continue; end if;
    -- Just after its drawer (or first).
    s := case when list[i][2] = '' then 0 else (select x.sort_order from product_placements x join products q on q.id = x.product_id
           where x.check_area_id = refill and x.id <> pl and x.prep_task_id is null
             and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = list[i][2] order by x.sort_order limit 1) end;
    if s is null then continue; end if;
    if exists (select 1 from product_placements where check_area_id = refill and id <> pl and sort_order = s + 1) then
      update product_placements set sort_order = sort_order + 1 where check_area_id = refill and id <> pl and sort_order > s;
    end if;
    update product_placements set sort_order = s + 1, heading = null where id = pl;
  end loop;
  -- No separate group heading left on any of the drawers.
  update product_placements set heading = null where check_area_id = refill and heading = 'Check the portioning';

  raise notice 'Freezer 2 drawers: %', (select string_agg(q.name || case when x.prep_task_id is not null then ' (needs portioning?)' else '' end, ', ' order by x.sort_order)
    from product_placements x join products q on q.id = x.product_id where x.check_area_id = refill and q.status = 'active');
end $$;
