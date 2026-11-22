-- Collection list grouping for Gold Class Bar and Gold Class Kitchen. Safe to run more than once.
-- Run AFTER db/migrations/025_collection_groups.sql. Change either in Admin → Departments.
--
-- * Gold Class Bar: by type, the way the storeroom shelves are set out. The categories are grouped into
--   Beer, cider & hard soda · Cocktails · Wine · Spirits · Liqueurs · Syrups · Coffee, tea & cordial ·
--   Juices & water · Fresh produce · Ice cream & frozen (each category keeps its own place inside its group,
--   e.g. the rums together). Groups set in Admin ("Listed under") are kept.
-- * Gold Class Kitchen: by where it's going, in walk order: To defrost · For Freezer 1 · For Freezer 2 ·
--   For Chest freezer · For Walk in fridge · For Dry stock (each line then just says its compartment or shelf).
do $$
declare
  bar uuid := (select id from departments where lower(name) = 'gold class bar');
  kitchen uuid := (select id from departments where lower(name) = 'gold class kitchen');
  i int;
  -- broader group, then the categories in it (matched ignoring case and spacing)
  fam text[][] := array[
    ['Beer, cider & hard soda', 'beer|cider|hardsoda'],
    ['Wine', 'redwine|sparklingwine|champagne|whitewine|rosewine|roséwine'],
    ['Spirits', 'vodka|tequila|gin|whisky|whiskey|bourbon|rum'],
    ['Coffee, tea & cordial', 'coffeecordial|coffee|tea|cordial'],
    ['Ice cream & frozen', 'icecream|frozen']
  ];
begin
  if not exists (select 1 from information_schema.columns where table_name = 'departments' and column_name = 'collect_group') then
    raise exception 'Run db/migrations/025_collection_groups.sql first';
  end if;
  if bar is not null then
    update departments set collect_group = 'type' where id = bar and collect_group is null;
    for i in 1 .. array_length(fam, 1) loop
      update categories set collect_group = fam[i][1]
        where department_id = bar and collect_group is null
          and regexp_replace(lower(name), '[^a-zé0-9]', '', 'g') = any(string_to_array(fam[i][2], '|'));
    end loop;
  end if;
  if kitchen is not null then
    update departments set collect_group = 'area' where id = kitchen and collect_group is null;
  end if;
  raise notice 'Collection list: %', (select string_agg(name || ' by ' || collect_group, ', ') from departments where collect_group is not null);
  raise notice 'Gold Class Bar types: %', (select string_agg(coalesce(collect_group, name), ' · ' order by sort_order) from
    (select distinct on (coalesce(collect_group, name)) collect_group, name, sort_order from categories where department_id = bar and active order by coalesce(collect_group, name), sort_order) t);
end $$;
