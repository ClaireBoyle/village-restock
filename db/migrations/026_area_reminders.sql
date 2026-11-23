-- Refill tasks done from another area's stock (e.g. the malt powder container at the milkshake station, refilled
-- from the coffee cupboard). Safe to run more than once. Until it runs, the app still works (no reminders).
--
-- * product_placements.remind_area_id: when this "Needs refill" task is ticked, that area's screen shows a reminder at
--   the top ("Refill the malt powder container"), ticked off there. It isn't put on the downstairs collection list.
alter table product_placements add column if not exists remind_area_id uuid references check_areas(id) on delete set null;
