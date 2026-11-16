-- Area restocks: a department can restock each of its areas on its own
-- (e.g. Candy Bar: the confection stand and the FOH drinks fridge at different times).
-- Each area restock is its own record, so history, shortages and emails name the area.
-- Departments keep their existing full restock unless "restock by area" is switched on.
-- Safe to run more than once.
alter table departments add column if not exists restock_by_area boolean not null default false;

-- A short reminder shown under a storeroom's heading on the collection list.
alter table storage_locations add column if not exists collect_note text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'storage_locations_collect_note_len') then
    alter table storage_locations add constraint storage_locations_collect_note_len check (length(collect_note) <= 200);
  end if;
end $$;

alter table restock_sessions add column if not exists area_id uuid references check_areas(id) on delete set null;
alter table restock_sessions add column if not exists area_name text;
alter table restock_sessions drop constraint if exists restock_sessions_kind_check;
alter table restock_sessions add constraint restock_sessions_kind_check check (kind in ('full', 'quick', 'area'));
create index if not exists restock_sessions_area on restock_sessions (department_id, trading_date) where kind = 'area';

-- Candy Bar: restock each area separately, with short instructions shown when they're useful.
-- Only fills in text that is still blank, so nothing a manager wrote is overwritten.
update departments set restock_by_area = true where lower(name) = 'candy bar' and not restock_by_area;
update check_areas a set guide_text = 'Check both sides of the stand. Enter the total quantity needed.'
  from departments d where d.id = a.department_id and lower(d.name) = 'candy bar' and lower(a.name) = 'confection stand' and trim(a.guide_text) = '';
update check_areas a set guide_text = 'Enter the quantity needed for each drink.'
  from departments d where d.id = a.department_id and lower(d.name) = 'candy bar' and lower(a.name) = 'foh drinks fridge' and trim(a.guide_text) = '';
update storage_locations set collect_note = 'Use opened boxes in Candy Bar BOH first. Get unopened boxes from Dry storage if needed.'
  where lower(name) = 'candy bar boh' and collect_note = '';
