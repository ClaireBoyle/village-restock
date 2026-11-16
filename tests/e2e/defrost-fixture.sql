-- Test-only defrost items for Gold Class Kitchen (illustrative values, not real kitchen settings).
insert into defrost_items (department_id, name, unit_singular, unit_plural, expected_demand, weekday_demand, buffer, pack_size, min_qty, thaw_method, thaw_hours, shelf_life_hours, safety_notes, sort_order)
select d.id, v.name, v.us, v.up, v.dem, v.wd::jsonb, v.buf, v.pack, v.mn, v.method, v.thaw, v.life, v.notes, v.ord
from departments d, (values
  ('Ingredient X',     'portion', 'portions', 24, '{}', 4, 1, 0, 'Coolroom, sealed tray, bottom shelf', 12, 72, 'Label with date and time when moved to thaw.', 1),
  ('Bao buns',         'pack',    'packs',     6, '{"sat":9,"fri":8}', 1, 1, 2, 'Coolroom, in original packaging', 8, 48, '', 2),
  ('Slow-cooked brisket', 'kg',   'kg',        3, '{}', 0.5, 0.5, 0, 'Coolroom, on a tray', 30, 72, 'Never thaw in the sink or at room temperature.', 3),
  ('Dumplings',        'portion', 'portions', 20, '{}', 2, 10, 10, '', null, 48, '', 4)
) as v(name, us, up, dem, wd, buf, pack, mn, method, thaw, life, notes, ord)
where d.name = 'Gold Class Kitchen';
