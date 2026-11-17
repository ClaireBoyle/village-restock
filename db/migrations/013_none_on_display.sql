-- "None on display" (Candy Bar): when staff collect less than needed it's Low stock, even at zero.
-- At zero they can tap "None on display" to mark it Out of stock. Safe to run more than once.
--
-- * departments.none_on_display: the department uses this rule (Candy Bar). Others keep
--   "collected none = Out of stock".
-- * session_items.none_on_display: staff tapped "None on display" for this item.
-- * shortages.none_on_display: the shortage was out of stock on display (for the Shortages page).
alter table departments add column if not exists none_on_display boolean not null default false;
alter table session_items add column if not exists none_on_display boolean not null default false;
alter table shortages add column if not exists none_on_display boolean not null default false;
update departments set none_on_display = true where lower(name) = 'candy bar' and not none_on_display;
