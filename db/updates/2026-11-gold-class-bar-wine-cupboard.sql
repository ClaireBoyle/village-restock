-- Gold Class Bar: every red wine is also in the Wine cupboard. Safe to run more than once.
-- * The same products as on the Back bench (not copies): if both places need the same wine,
--   the collection list adds the amounts together.
-- * Wines already in the Wine cupboard keep their place; missing red wines are added after them,
--   in Back bench order. Staff enter what's needed (no targets). Nothing is removed.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  cupboard uuid; bench uuid; r record; k int; n int := 0;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  cupboard := (select id from check_areas where department_id = dept and lower(name) = 'wine cupboard' order by active desc limit 1);
  if cupboard is null then
    insert into check_areas (department_id, name, sort_order)
      values (dept, 'Wine cupboard', coalesce((select max(sort_order) from check_areas where department_id = dept), 0) + 1) returning id into cupboard;
  end if;
  update check_areas set active = true where id = cupboard;
  bench := (select id from check_areas where department_id = dept and lower(name) = 'back bench');
  k := coalesce((select max(sort_order) from product_placements where check_area_id = cupboard), 0);
  for r in
    select p.id from products p join categories c on c.id = p.category_id
    left join product_placements b on b.product_id = p.id and b.check_area_id = bench
    where p.department_id = dept and p.status = 'active' and lower(c.name) = 'red wine'
      and not exists (select 1 from product_placements x where x.product_id = p.id and x.check_area_id = cupboard)
    order by b.sort_order nulls last, p.name
  loop
    k := k + 1; n := n + 1;
    insert into product_placements (product_id, check_area_id, sort_order) values (r.id, cupboard, k);
  end loop;
  raise notice 'Wine cupboard: % red wines added', n;
end $$;
