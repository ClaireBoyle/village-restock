-- Small subheadings inside a checking area (e.g. "Mixers, Water & Milk" then "Beer, Cider & Hard Soda").
-- A heading is shown above the product it's set on; the area stays one area with one list.
-- Safe to run more than once.
alter table product_placements add column if not exists heading text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'product_placements_heading_len') then
    alter table product_placements add constraint product_placements_heading_len check (heading is null or length(heading) between 1 and 40);
  end if;
end $$;
