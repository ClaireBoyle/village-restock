-- Email managers after every finished restock, even a clean one (Candy Bar). Safe to run more than once.
-- Other departments keep "only when there's something to act on" (shortages, comments, exceptions).
alter table departments add column if not exists email_every_restock boolean not null default false;
update departments set email_every_restock = true where lower(name) = 'candy bar' and not email_every_restock;
