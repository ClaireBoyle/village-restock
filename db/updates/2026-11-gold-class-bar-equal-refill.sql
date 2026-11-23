-- Gold Class Bar: Equal packets work like the sugar packets. Safe to run more than once. Only touches Gold Class Bar.
--
-- * At the Coffee machine (Check the bar → Coffee cupboard), Equal is a "Needs refill" task: tap it when the Equal
--   container is low. On Upstairs, the Upstairs cupboards list says "Take the Equal container (next to the coffee
--   machine) to the upstairs cupboard and fill it to the top." Nothing is counted or entered.
-- * The same product record is reused. Its own Upstairs cupboards stock row goes, as the sugar has none: the
--   container is refilled from the cupboard. Past restocks keep their history.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class bar');
  machine uuid; ups uuid; p uuid; pl uuid; n int;
begin
  if dept is null then raise notice 'Gold Class Bar not found: nothing changed'; return; end if;
  machine := (select id from check_areas where department_id = dept and active and lower(name) = 'coffee machine' limit 1);
  ups := (select id from check_areas where department_id = dept and active and lower(name) = 'upstairs cupboards' limit 1);
  if machine is null or ups is null then raise exception 'Run 2026-11-gold-class-bar-coffee-cupboard.sql first (Coffee machine, Upstairs cupboards)'; end if;
  p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('equalpackets', 'equalpacket', 'equal', 'equalsweetener', 'equalcontainer')
        order by (status = 'active') desc, created_at limit 1);
  if p is null then
    insert into products (department_id, name, unit_singular, unit_plural, method, sort_order)
      values (dept, 'Equal packets', 'container', 'containers', 'routine', (select coalesce(max(sort_order), 0) + 1 from products where department_id = dept)) returning id into p;
  end if;
  -- A "Needs refill" task, like the sugar.
  update products set status = 'active', method = 'routine', unit_singular = 'container', unit_plural = 'containers',
    instructions = 'Take the Equal container (next to the coffee machine) to the upstairs cupboard and fill it to the top.'
    where id = p;
  -- At the Coffee machine, after the sugar; refilled from the upstairs cupboard.
  pl := (select id from product_placements where product_id = p and check_area_id = machine limit 1);
  if pl is null then
    insert into product_placements (product_id, check_area_id, sort_order) values (p, machine, 2) returning id into pl;
  end if;
  n := coalesce((select max(x.sort_order) from product_placements x join products q on q.id = x.product_id
                 where x.check_area_id = machine and q.status = 'active' and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') like 'sugar%'), 1);
  update product_placements set sort_order = n + 1, par_level = null, heading = null, instructions = null, location_id = null,
    pickup_area_id = ups, pickup_suggest = false, unit_singular = null, unit_plural = null
    where id = pl;
  -- No separate stock row for it anywhere else (the sugar has none).
  delete from product_placements where product_id = p and id <> pl;
  update check_areas set guide_text = 'The sugar and Equal containers next to the coffee machine.'
    where id = machine and guide_text = 'The sugar container next to the coffee machine.';

  raise notice 'Coffee machine: %', (select string_agg(q.name || case when q.method = 'routine' then ' (needs refill, from ' || coalesce(a.name, '?') || ')' else '' end, ', ' order by x.sort_order)
    from product_placements x join products q on q.id = x.product_id left join check_areas a on a.id = x.pickup_area_id where x.check_area_id = machine and q.status = 'active');
end $$;
