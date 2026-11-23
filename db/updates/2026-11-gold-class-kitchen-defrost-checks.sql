-- Gold Class Kitchen → Defrost: grouped by where staff check what's already ready, in this order.
-- Safe to run more than once. Only touches Gold Class Kitchen's Defrost rows (and the pulled beef's unit).
--
--   Under-salad-bar bench fridge             Pulled Beef (Bao) ("Check portioned beef first"),
--                                            Beef Patties ("Check the right side")
--   Check location to confirm                every other row whose check location isn't confirmed yet
--                                            (e.g. Bao Buns, Grilled Chicken, Naan Bread, 9" Pizza Bases)
--   Upstairs walk-in fridge · Dessert shelf  everything defrosted onto the dessert shelf (desserts and extras)
--
-- * Where it's pulled from (freezer compartment) and where it goes (destination) are unchanged: only the grouping,
--   and the check notes. The pulled beef's old "Check the portioned beef …" grab note becomes the short note.
-- * Pulled Beef (Bao) is counted in 1 kg bags ("1 × 1 kg bag"), if it was in plain bags.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  def uuid; r record; n int := 0; m int := 0;
  norm text;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  def := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'defrost' limit 1);
  if def is null then raise notice 'Defrost area not found: nothing changed'; return; end if;

  for r in select x.id, q.id as product_id, q.name, x.sort_order, coalesce(x.put_note, '') as put_note
           from product_placements x join products q on q.id = x.product_id
           where x.check_area_id = def and q.status = 'active' order by x.sort_order, q.name loop
    norm := regexp_replace(lower(r.name), '[^a-z0-9]', '', 'g');
    if norm like 'pulledbeef%' then
      update product_placements set sort_order = 1, heading = 'Under-salad-bar bench fridge',
        instructions = coalesce(nullif(trim(instructions), ''), 'Check portioned beef first'),
        grab_note = case when grab_note ilike 'check the portioned beef%' then null else grab_note end
        where id = r.id;
      update products set unit_singular = '1 kg bag', unit_plural = '1 kg bags'
        where id = r.product_id and lower(unit_singular) = 'bag' and lower(unit_plural) = 'bags';
    elsif norm like 'beefpatt%' then
      update product_placements set sort_order = 2, heading = null,
        instructions = coalesce(nullif(trim(instructions), ''), 'Check the right side')
        where id = r.id;
    elsif r.put_note ilike '%dessert shelf%' then
      m := m + 1;
      update product_placements set sort_order = 100 + m, heading = case when m = 1 then 'Upstairs walk-in fridge · Dessert shelf' else null end
        where id = r.id;
    else
      n := n + 1;
      update product_placements set sort_order = 10 + n, heading = case when n = 1 then 'Check location to confirm' else null end
        where id = r.id;
    end if;
  end loop;

  -- Only what's needed is entered: a blank row means nothing to defrost (Not needed is optional).
  update check_areas set guide_text = 'Check what''s ready, then enter only what needs defrosting. Blank means not needed.'
    where id = def and guide_text in ('Defrost for tomorrow: set an amount, or Not needed. Freezer drawers are refilled under Freezer 2.',
                                      'Check what''s ready, then set what to defrost or tap Not needed.', '');

  raise notice 'Defrost: %', (select string_agg(case when x.heading is not null then '[' || x.heading || '] ' else '' end || q.name, ', ' order by x.sort_order)
    from product_placements x join products q on q.id = x.product_id where x.check_area_id = def and q.status = 'active');
  raise notice 'Check location to confirm: %', coalesce((select string_agg(q.name, ', ' order by x.sort_order) from product_placements x join products q on q.id = x.product_id
    where x.check_area_id = def and q.status = 'active' and x.sort_order between 11 and 99), 'none');
end $$;
