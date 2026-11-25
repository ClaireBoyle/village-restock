-- Candy Bar confection stand: less text on the check screen. Safe to run more than once.
-- * The stand's note "Enter what this side needs." goes (the Side A / Side B switch says it already).
-- * The water stand's note "The water stand next to the confection stand: enter how many bottles it needs." goes
--   (the "Water stand" subheading is enough).
-- Only these two exact wordings are removed: anything a manager has written instead is kept.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'candy bar');
  stand uuid;
begin
  if dept is null then raise notice 'Candy Bar not found: nothing changed'; return; end if;
  stand := (select id from check_areas where department_id = dept and parent_area_id is null and lower(name) = 'confection stand' limit 1);
  if stand is null then raise notice 'Confection stand not found: nothing changed'; return; end if;

  update check_areas set guide_text = ''
    where (id = stand or parent_area_id = stand) and guide_text in ('Enter what this side needs.', 'Enter what each side needs.');
  update product_placements set instructions = null
    where check_area_id = stand and instructions ilike 'The water stand next to the confection stand%';

  raise notice 'Confection stand: note "%", water stand note "%"',
    (select guide_text from check_areas where id = stand),
    coalesce((select string_agg(instructions, ' | ') from product_placements where check_area_id = stand and instructions is not null), '');
end $$;
