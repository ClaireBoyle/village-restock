-- Gold Class Kitchen Defrost: short directions. Safe to run more than once. Run AFTER
-- 2026-11-gold-class-kitchen-portion-prep.sql (and the earlier Gold Class Kitchen scripts). Only touches Gold Class Kitchen.
--
-- Each Defrost row now reads "where it's grabbed → where it goes" (e.g. "Freezer 1 · Lower left → Upstairs
-- walk-in fridge"), worked out from the freezer spot, plus one short detail where it matters (e.g. "Check
-- the portioned beef in the under-salad-bar bench fridge first"). What to do if upstairs runs short
-- ("If empty") is shown only after "Not enough upstairs".
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  defrost uuid; i int; pl uuid; norm text;
  -- product, detail ('' = none), where it goes
  list text[][] := array[
    ['Pulled Beef (Bao)', 'Check the portioned beef in the under-salad-bar bench fridge first', 'Upstairs walk-in fridge'],
    ['Bao Buns', 'Bao buns tub (the lower-right tub)', 'Upstairs walk-in fridge'],
    ['Beef Patties', '', 'Under-salad-bar bench fridge (right side)'],
    ['Buns (Portioned Tubs)', '', 'Upstairs walk-in fridge (portioned tubs)'],
    ['9" Pizza Bases', 'The labelled 9" Pizza Bases drawer', 'Upstairs walk-in fridge'],
    ['Grilled Chicken', 'Above the arancini drawer · usually 1 packet', 'Upstairs walk-in fridge'],
    ['Naan Bread', 'Naan bread tub (the lower-left tub)', 'Upstairs walk-in fridge'],
    ['Basque Cheesecake', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Chocolate Mousse Cake', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Sour Cherry Gel', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Golden Crumb', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Passionfruit Sponge', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Raspberry Coulis', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Salted Caramel Sauce', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Brownie', '', 'Upstairs walk-in fridge · dessert shelf'],
    ['Sticky Date', '', 'Upstairs walk-in fridge · dessert shelf']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  defrost := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'defrost' limit 1);
  if defrost is null then raise exception 'Run 2026-11-gold-class-kitchen-defrost.sql first'; end if;

  for i in 1 .. array_length(list, 1) loop
    norm := regexp_replace(lower(list[i][1]), '[^a-z0-9]', '', 'g');
    pl := (select x.id from product_placements x join products q on q.id = x.product_id
           where x.check_area_id = defrost and q.department_id = dept and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = norm limit 1);
    if pl is null then continue; end if;
    update product_placements set grab_note = nullif(list[i][2], ''), put_note = list[i][3] where id = pl;
  end loop;
  -- Desserts come straight from downstairs: no "If empty" for them.
  update product_placements x set fallback_note = null from products q
    where q.id = x.product_id and x.check_area_id = defrost and x.pickup_area_id is null and x.fallback_note = 'Downstairs walk-in freezer';

  update check_areas set guide_text = 'Defrost for tomorrow: set an amount, or Not needed. Freezer drawers are refilled under Freezer 2.' where id = defrost;

  raise notice 'Defrost: % items, short directions (% with a detail)',
    (select count(*) from product_placements where check_area_id = defrost),
    (select count(*) from product_placements where check_area_id = defrost and grab_note is not null);
end $$;
