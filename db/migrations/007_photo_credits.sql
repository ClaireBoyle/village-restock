-- Credit line for photos that come from an open source (e.g. Open Food Facts, CC BY-SA),
-- shown wherever the photo is enlarged. Safe to run more than once.
alter table photos add column if not exists credit text check (credit is null or length(credit) <= 200);
alter table photos add column if not exists source_url text check (source_url is null or length(source_url) <= 500);
