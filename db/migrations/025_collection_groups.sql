-- Collection list grouping, inside each storeroom. Safe to run more than once.
-- Until it runs, the app still works (one list per storeroom, as before).
--
-- * departments.collect_group: how a storeroom's lines are grouped on the collection list:
--   'type' (by product type, e.g. Beer, cider & hard soda · Wine · Spirits: how the storeroom shelves are set out),
--   'area' (by where it's going, in walk order, e.g. To defrost · Freezer 1 · Freezer 2), or blank (not grouped).
-- * categories.collect_group: the broader type a category is listed under when grouping by type
--   (e.g. Red Wine, White Wine, Rosé Wine, Sparkling Wine, Champagne → "Wine"). Blank = its own name.
alter table departments add column if not exists collect_group text;
alter table categories add column if not exists collect_group text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'departments_collect_group_check') then
    alter table departments add constraint departments_collect_group_check check (collect_group is null or collect_group in ('type', 'area'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'categories_collect_group_len') then
    alter table categories add constraint categories_collect_group_len check (collect_group is null or length(collect_group) <= 40);
  end if;
end $$;
