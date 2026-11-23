-- Gold Class Bar → Confection: the same product photos as the Candy Bar confection (matched by name, ignoring case
-- and punctuation). Safe to run more than once. Only fills in products with no photo yet (a photo already set on
-- a Bar product is kept). The photo itself is shared, not copied: removing it from one product keeps it for the other.
do $$
declare
  bar uuid := (select id from departments where lower(name) = 'gold class bar');
  candy uuid := (select id from departments where lower(name) = 'candy bar');
  conf uuid; n int;
begin
  if bar is null or candy is null then raise notice 'Gold Class Bar or Candy Bar not found: nothing changed'; return; end if;
  conf := (select id from check_areas where department_id = bar and active and lower(name) = 'confection' limit 1);
  if conf is null then raise notice 'Gold Class Bar has no Confection area: nothing changed'; return; end if;

  update products b set photo_path = c.photo_path
    from products c
    where b.department_id = bar and b.status = 'active' and coalesce(b.photo_path, '') = ''
      and exists (select 1 from product_placements x where x.product_id = b.id and x.check_area_id = conf)
      and c.department_id = candy and c.status = 'active' and coalesce(c.photo_path, '') <> ''
      and regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g');
  get diagnostics n = row_count;

  raise notice '% Confection photos added from the Candy Bar', n;
  raise notice 'Confection with a photo: % of %',
    (select count(*) from products b where exists (select 1 from product_placements x where x.product_id = b.id and x.check_area_id = conf) and b.status = 'active' and coalesce(b.photo_path, '') <> ''),
    (select count(*) from products b where exists (select 1 from product_placements x where x.product_id = b.id and x.check_area_id = conf) and b.status = 'active');
  raise notice 'Still no photo: %', coalesce((select string_agg(b.name, ', ' order by b.name) from products b
    where exists (select 1 from product_placements x where x.product_id = b.id and x.check_area_id = conf) and b.status = 'active' and coalesce(b.photo_path, '') = ''), 'none');
end $$;
