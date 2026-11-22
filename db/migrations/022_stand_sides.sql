-- Sides of a stand (Candy Bar confection stand: Side A / Side B). Safe to run more than once.
-- Until it runs, the app still works: a stand just isn't split into sides yet.
--
-- * check_areas.section_mode 'side': a section that's one side of a stand. Staff switch between the sides
--   (Side A / Side B) and enter what each side needs; the collection list shows each product once with its total
--   and the split, and "Fill Side A" / "Fill Side B" lists what goes back on each side.
alter table check_areas drop constraint if exists check_areas_section_mode_check;
alter table check_areas add constraint check_areas_section_mode_check check (section_mode in ('open', 'collapsed', 'optional', 'side'));
