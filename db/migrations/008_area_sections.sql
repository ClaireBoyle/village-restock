-- Area sections: an area can be shown as a section inside another area's screen
-- (e.g. Back bench with "Other FOH spirits" and an optional "Spirits cupboard").
-- Products still have one catalogue entry; each section is just another placement.
-- Safe to run more than once.
alter table check_areas add column if not exists parent_area_id uuid references check_areas(id) on delete set null;
alter table check_areas add column if not exists section_mode text not null default 'open';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'check_areas_section_mode_check') then
    alter table check_areas add constraint check_areas_section_mode_check check (section_mode in ('open', 'collapsed', 'optional'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'check_areas_parent_not_self') then
    alter table check_areas add constraint check_areas_parent_not_self check (parent_area_id is null or parent_area_id <> id);
  end if;
end $$;
