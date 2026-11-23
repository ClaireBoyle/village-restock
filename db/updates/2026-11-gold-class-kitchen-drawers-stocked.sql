-- Gold Class Kitchen → Freezer 2 → Refill working drawers and tubs: no instructions line (each drawer is just its
-- name, Stocked and Needs stock). Safe to run more than once. Instructions written in Admin are kept.
update check_areas set guide_text = ''
  where department_id = (select id from departments where lower(name) = 'gold class kitchen')
    and lower(name) = lower('Freezer 2 · Refill working drawers and tubs')
    and guide_text in ('Refill each working drawer and tub from the stock shown under it. Tap Refilled, Already full or Needs stock.',
                       'Stocked or Needs stock. Anything needed from downstairs goes under the spare stock below.');
