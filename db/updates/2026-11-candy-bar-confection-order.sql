-- Candy Bar confection stand: order and subheadings that follow the stand (from the photos of it).
-- Run AFTER 2026-11-candy-bar-confection-additions.sql. Safe to run more than once.
-- Only touches Candy Bar's "Confection stand".
--
-- Most products hang on both sides of the stand and on the end, so the list is grouped the way
-- the stand is merchandised, in walking order from the water stand: each family's flavours are
-- together, staff check a family on both sides and enter one total.
--
--   Water stand          Mount Franklin Still Water
--   Chocolate hang bags    Snickers Pods, Mars Pods, Maltesers, Maltesers Duos ×2, M&Ms ×3, Reese's ×2, Cookie Time
--   Lollies              Skittles ×5, Sour Patch Kids, Allen's ×2
--   Bars & Nerds   Snickers Bar, Mars Bar, Kit Kat, Nerds ×2
--   Chips & Pringles     Pringles ×2, Thins ×2, Smith's ×2, Twisties
--   Fairy floss & popcorn  Fairy Floss, Parlour Lane ×4
--
-- The collection list follows the same order, so the Candy Bar BOH pick goes family by family too.
-- Anything on the stand that isn't listed here stays, after these. Fine-tune in Admin → Arrange.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'candy bar');
  stand uuid; pl uuid; k int := 0; i int; done uuid[] := '{}';
  -- product name, heading above it
  list text[][] := array[
    ['Mount Franklin Still Water', 'Water stand'],
    ['Snickers Pods', 'Chocolate hang bags'],
    ['Mars Pods', ''],
    ['Maltesers', ''],
    ['Maltesers Duos Strawberry', ''],
    ['Maltesers Duos White & Milk Choc', ''],
    ['Milk M&Ms', ''],
    ['Peanut M&Ms', ''],
    ['Crispy M&Ms', ''],
    ['Reese''s Minis', ''],
    ['Reese''s Pieces', ''],
    ['Cookie Time Strawberries & Cream', ''],
    ['Skittles', 'Lollies'],
    ['Sour Skittles', ''],
    ['Skittles Giants Filled', ''],
    ['Skittles Jellies Kittens', ''],
    ['Skittles Jellies Pandas', ''],
    ['Sour Patch Kids', ''],
    ['Allen''s Snakes', ''],
    ['Allen''s Party Mix', ''],
    ['Snickers Bar', 'Bars & Nerds'],
    ['Mars Bar', ''],
    ['Kit Kat', ''],
    ['Nerds Gummy Clusters', ''],
    ['Berry Nerds Gummy Clusters', ''],
    ['Pringles Original', 'Chips & Pringles'],
    ['Pringles Sour Cream & Onion', ''],
    ['Thins Original', ''],
    ['Thins Light & Tangy', ''],
    ['Smith''s Original', ''],
    ['Smith''s Salt & Vinegar', ''],
    ['Twisties', ''],
    ['Fairy Floss', 'Fairy floss & popcorn'],
    ['Parlour Lane Popcorn Sweet & Salty', ''],
    ['Parlour Lane Popcorn Caramel', ''],
    ['Parlour Lane Popcorn New York Cheese', ''],
    ['Parlour Lane Popcorn Spicy Nacho', '']
  ];
begin
  if dept is null then raise notice 'Candy Bar not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'heading') then
    raise exception 'Run db/migrations/011_placement_headings.sql first';
  end if;
  stand := (select id from check_areas where department_id = dept and active and lower(name) = 'confection stand' limit 1);
  if stand is null then raise notice 'Candy Bar has no Confection stand: nothing changed'; return; end if;

  for i in 1 .. array_length(list, 1) loop
    -- Matched by name, ignoring case (e.g. "Kit kat").
    pl := (select x.id from product_placements x join products p on p.id = x.product_id and p.status = 'active'
           where x.check_area_id = stand and lower(p.name) = lower(list[i][1]) limit 1);
    if pl is null then continue; end if;
    k := k + 1;
    update product_placements set sort_order = k, heading = nullif(list[i][2], '') where id = pl;
    done := done || pl;
  end loop;
  -- Anything else on the stand keeps its order, after these, without a heading.
  for pl in select id from product_placements where check_area_id = stand and not (id = any(done)) order by sort_order, created_at loop
    k := k + 1;
    update product_placements set sort_order = k, heading = null where id = pl;
  end loop;
  -- A one-line route for the stand (only replaces the current wording).
  update check_areas set guide_text = 'Start at the water stand and walk both sides. Enter the total needed for each product.'
    where id = stand and (trim(coalesce(guide_text, '')) = '' or guide_text = 'Check both sides of the stand. Enter the total quantity needed.');
  raise notice 'Confection stand: % products in stand order (% not in the list)', k, k - array_length(done, 1);
end $$;
