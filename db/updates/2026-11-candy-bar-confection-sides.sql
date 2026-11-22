-- Candy Bar confection stand: Side A and Side B. Safe to run more than once. Run AFTER db/migrations/022_stand_sides.sql.
-- Only touches the Candy Bar's Confection stand.
--
-- * Two sides on the Confection stand screen (a Side A / Side B switch): the same products on each, in the same
--   order and with the same subheadings. Staff enter what each side needs; the collection list shows each product
--   once ("Snickers Pods · Collect 5", "Side A · 3  Side B · 2"); Fill Side A / Fill Side B lists what goes back.
-- * The existing rows (and their history) become Side A; Side B gets the same products. The water stand stays as it
--   is, above the switch (it's next to the stand, not one side of it).
-- * The stand's note becomes "Enter what this side needs." (unless a manager has written their own).
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'candy bar');
  stand uuid; sa uuid; sb uuid; n int := 0;
begin
  if dept is null then raise notice 'Candy Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from pg_constraint where conname = 'check_areas_section_mode_check' and pg_get_constraintdef(oid) like '%side%') then
    raise exception 'Run db/migrations/022_stand_sides.sql first';
  end if;
  stand := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'confection stand' limit 1);
  if stand is null then raise notice 'Confection stand not found: nothing changed'; return; end if;

  sa := (select id from check_areas where department_id = dept and parent_area_id = stand and lower(name) = lower('Confection stand · Side A') limit 1);
  if sa is null then insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode) values (dept, 'Confection stand · Side A', 1, stand, 'side') returning id into sa; end if;
  sb := (select id from check_areas where department_id = dept and parent_area_id = stand and lower(name) = lower('Confection stand · Side B') limit 1);
  if sb is null then insert into check_areas (department_id, name, sort_order, parent_area_id, section_mode) values (dept, 'Confection stand · Side B', 2, stand, 'side') returning id into sb; end if;
  update check_areas set active = true, section_mode = 'side', parent_area_id = stand, guide_text = '' where id in (sa, sb);
  update check_areas set sort_order = 1 where id = sa;
  update check_areas set sort_order = 2 where id = sb;

  -- The stand's own rows (not the water stand) move to Side A, keeping their order, subheadings and history.
  update product_placements x set check_area_id = sa
    from products q
    where q.id = x.product_id and x.check_area_id = stand
      and coalesce(x.heading, '') <> 'Water stand' and q.name not ilike 'Mount Franklin%';
  -- Side B: the same products as Side A (added once; anything a manager changes there afterwards is kept).
  insert into product_placements (product_id, check_area_id, sort_order, heading, instructions, location_id, par_level, unit_singular, unit_plural)
    select x.product_id, sb, x.sort_order, x.heading, x.instructions, x.location_id, x.par_level, x.unit_singular, x.unit_plural
    from product_placements x
    where x.check_area_id = sa and not exists (select 1 from product_placements y where y.check_area_id = sb and y.product_id = x.product_id);
  get diagnostics n = row_count;

  -- The old "check both sides and enter the total" wording goes from the stand's products too (rows and products).
  update product_placements set instructions = null where check_area_id in (sa, sb) and instructions ilike '%both sides%';
  update products q set instructions = '' where q.department_id = dept and q.instructions ilike '%both sides%'
    and exists (select 1 from product_placements x where x.product_id = q.id and x.check_area_id in (sa, sb));
  update check_areas set guide_text = 'Enter what this side needs.'
    where id = stand and (trim(coalesce(guide_text, '')) = '' or guide_text ilike '%both sides%' or guide_text ilike '%enter the total%');

  raise notice 'Confection stand: water stand %; Side A % products; Side B % products (% added)',
    (select count(*) from product_placements where check_area_id = stand),
    (select count(*) from product_placements where check_area_id = sa),
    (select count(*) from product_placements where check_area_id = sb), n;
end $$;
