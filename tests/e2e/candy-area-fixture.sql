-- Load AFTER candy-fixture.sql: Candy Bar restocked area by area, as set up by migration 009 (test database only).
update departments set restock_by_area = true where name = 'Candy Bar';
update check_areas set guide_text = 'Check both sides of the stand. Enter the total quantity needed.' where name = 'Confection stand' and active;
update check_areas set guide_text = 'Enter the quantity needed for each drink.' where name = 'FOH drinks fridge' and active;
update storage_locations set collect_note = 'Use opened boxes in Candy Bar BOH first. Get unopened boxes from Dry storage if needed.' where name = 'Candy Bar BOH';
