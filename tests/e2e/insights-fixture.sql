-- Test-only history for Stock Insights: the last 7 trading days (illustrative, not real data).
-- Run after the seed and defrost-fixture.sql.
do $$
declare
  today date := ((now() at time zone 'Australia/Melbourne') - interval '5 hours')::date;
  d date; k int; s_k uuid; s_c uuid; plan uuid;
  kit uuid := (select id from departments where name = 'Gold Class Kitchen');
  cb uuid := (select id from departments where name = 'Candy Bar');
  ins_item record;
begin
  for k in 1..7 loop
    d := today - k;
    insert into restock_sessions (id, department_id, kind, trading_date, status, started_at, finished_at, people)
      values (gen_random_uuid(), kit, 'full', d, 'finished', d + time '22:00', d + time '23:30', array['Sam']) returning id into s_k;
    insert into restock_sessions (id, department_id, kind, trading_date, status, started_at, finished_at, people)
      values (gen_random_uuid(), cb, 'full', d, 'finished', d + time '22:00', d + time '23:00', array['Jess']) returning id into s_c;
    -- Tomatoes (target 8): short in the storeroom on 3 days
    insert into session_items (session_id, placement_id, product_id, check_area_id, product_name, unit_singular, unit_plural, method, par_level, current_qty, collected_mode, collected_qty, shortfall_reason)
      select s_k, pl.id, p.id, pl.check_area_id, p.name, p.unit_singular, p.unit_plural, p.method, pl.par_level, 3,
        case when k in (1, 3, 5) then 'partial' else 'all' end, case when k in (1, 3, 5) then 2 end, case when k in (1, 3, 5) then 'insufficient' end
      from products p join product_placements pl on pl.product_id = p.id where p.name = 'Tomatoes';
    -- Lemons: needed most days, short once -> may be outpacing orders
    insert into session_items (session_id, placement_id, product_id, check_area_id, product_name, unit_singular, unit_plural, method, par_level, current_qty, collected_mode, collected_qty, shortfall_reason)
      select s_k, pl.id, p.id, pl.check_area_id, p.name, p.unit_singular, p.unit_plural, p.method, pl.par_level, 4,
        case when k = 2 then 'partial' else 'all' end, case when k = 2 then 3 end, case when k = 2 then 'insufficient' end
      from products p join product_placements pl on pl.product_id = p.id where p.name = 'Lemons' and k <= 6;
    -- Maltesers (staff enter): 12 every night, always collected -> high turnover, not a problem
    insert into session_items (session_id, placement_id, product_id, check_area_id, product_name, unit_singular, unit_plural, method, requested_qty, collected_mode)
      select s_c, pl.id, p.id, pl.check_area_id, p.name, p.unit_singular, p.unit_plural, p.method, 12, 'all'
      from products p join product_placements pl on pl.product_id = p.id where p.name = 'Maltesers';
    -- Pods: not collected because of time on 3 days (not a stock problem)
    insert into session_items (session_id, placement_id, product_id, check_area_id, product_name, unit_singular, unit_plural, method, requested_qty, collected_mode, collected_qty, shortfall_reason)
      select s_c, pl.id, p.id, pl.check_area_id, p.name, p.unit_singular, p.unit_plural, p.method, 4, 'partial', 0, 'time'
      from products p join product_placements pl on pl.product_id = p.id where p.name = 'Pods' and k in (2, 4, 6);
    -- Defrost Planner records for the service on day d
    insert into defrost_plans (id, department_id, service_date) values (gen_random_uuid(), kit, d) returning id into plan;
    for ins_item in select id, name from defrost_items where department_id = kit and name in ('Ingredient X', 'Bao buns') loop
      insert into defrost_entries (plan_id, item_id, item_name, chilled_qty, thawing_qty, suggested_qty, defrost_qty, ran_out, discarded_qty, discard_reason)
      values (plan, ins_item.id, ins_item.name, 10, 0, 18, 18,
        ins_item.name = 'Ingredient X' and k in (1, 2, 4),
        case when ins_item.name = 'Bao buns' and k in (3, 6) then 3 end, case when ins_item.name = 'Bao buns' and k in (3, 6) then 'Past its use-by' end);
    end loop;
  end loop;
end $$;
