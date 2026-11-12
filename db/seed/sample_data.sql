-- Village Restock: SAMPLE data (optional)
-- Example departments, areas and products so you can try the app straight
-- away. Every row is marked is_sample = true and can be removed in one step
-- from Admin > Overview > "Remove sample data".
-- Products and par levels are made up. They are NOT real Village targets.
--
-- Safe to run more than once: anything already there is skipped.

insert into departments (name, short_name, group_label, theme, icon, description, sort_order, is_sample) values
  ('Gold Class Bar',     'Bar',       'Gold Class', 'gold',    'bar',     'Bar fridges, back shelf, spirits and glassware', 1, true),
  ('Gold Class Kitchen', 'Kitchen',   'Gold Class', 'gold',    'kitchen', 'Fridges, freezer and dry storage',               2, true),
  ('Candy Bar',          'Candy Bar', 'Trad',       'village', 'candy',   'Confectionery stand, choc-tops, cups and syrups', 3, true)
on conflict do nothing;

insert into storage_locations (name, sort_order, is_sample) values
  ('Alcohol Storeroom', 1, true), ('Main Dry Store', 2, true), ('Bar Back of House', 3, true),
  ('Kitchen Coolroom', 4, true), ('Kitchen Freezer Room', 5, true), ('Kitchen Dry Storage', 6, true),
  ('Candy Bar Back of House', 7, true)
on conflict do nothing;

insert into check_areas (department_id, name, guide_text, sort_order, is_sample)
select d.id, a.name, a.guide, a.ord, true
from (values
  ('Gold Class Kitchen', 'Fridge 1', 'Top shelf: dairy and cheese. Middle: produce. Bottom: lettuce and herbs in labelled tubs. Oldest stock at the front.', 1),
  ('Gold Class Kitchen', 'Fridge 2', 'Sauces on the door. Proteins on the bottom shelf only, in lidded containers.', 2),
  ('Gold Class Kitchen', 'Freezer 1', 'Fries on the left, buns on the right. Keep the lid sealed and the fill line clear.', 3),
  ('Gold Class Kitchen', 'Dry storage shelf', 'Sauces on the top shelf, packaging below. Labels facing out.', 4),
  ('Gold Class Bar', 'Bar fridge', 'Beer on the top two shelves, wine piccolos below, soft drinks on the bottom. Labels facing out.', 1),
  ('Gold Class Bar', 'Back shelf', 'Back-up beer on the left, wine in the middle, mixers on the right.', 2),
  ('Gold Class Bar', 'Spirits & syrups', 'Spirits in the speed rail, syrups on the shelf above with pumps attached.', 3),
  ('Gold Class Bar', 'Glassware & napkins', 'Wine glasses upside down on the rack. Napkins stacked beside the till.', 4),
  ('Candy Bar', 'Confectionery stand', 'One row per product. Fill each row to the front edge.', 1),
  ('Candy Bar', 'Choc-top freezer', 'One labelled row per flavour. Do not stack higher than the load line.', 2),
  ('Candy Bar', 'Cups & syrups', 'Cup sleeves under the counter by size. Syrup bottles beside the drink machine.', 3)
) as a(dept, name, guide, ord)
join departments d on d.name = a.dept
on conflict do nothing;

insert into categories (department_id, name, sort_order, is_sample)
select d.id, c.name, c.ord, true
from (values
  ('Gold Class Kitchen', 'Produce', 1), ('Gold Class Kitchen', 'Dairy', 2), ('Gold Class Kitchen', 'Sauces', 3),
  ('Gold Class Kitchen', 'Proteins', 4), ('Gold Class Kitchen', 'Frozen', 5), ('Gold Class Kitchen', 'Bakery', 6),
  ('Gold Class Kitchen', 'Desserts', 7), ('Gold Class Kitchen', 'Packaging', 8), ('Gold Class Kitchen', 'Cleaning', 9),
  ('Gold Class Bar', 'Beer', 1), ('Gold Class Bar', 'Wine', 2), ('Gold Class Bar', 'Soft drinks', 3),
  ('Gold Class Bar', 'Mixers', 4), ('Gold Class Bar', 'Spirits', 5), ('Gold Class Bar', 'Syrups', 6),
  ('Gold Class Bar', 'Garnishes', 7), ('Gold Class Bar', 'Glassware', 8), ('Gold Class Bar', 'Consumables', 9),
  ('Candy Bar', 'Confectionery', 1), ('Candy Bar', 'Frozen', 2), ('Candy Bar', 'Cups', 3),
  ('Candy Bar', 'Syrups', 4), ('Candy Bar', 'Packaging', 5)
) as c(dept, name, ord)
join departments d on d.name = c.dept
on conflict do nothing;

-- Products and where they're checked, in one statement (no temporary tables,
-- so it works in the Supabase SQL Editor). One row per placement: a product
-- listed in two areas (Stone & Wood) becomes one product with two placements.
with s (dept, area, product, category, unit_s, unit_p, method, par, location, instructions, dec, ord) as (values
  ('Gold Class Kitchen','Fridge 1','Tomatoes','Produce','tomato','tomatoes','par',8,'Kitchen Coolroom','Ripe but firm. Rotate older stock to the front.',false,1),
  ('Gold Class Kitchen','Fridge 1','Cos lettuce','Produce','head','heads','par',4,'Kitchen Coolroom','',false,2),
  ('Gold Class Kitchen','Fridge 1','Lemons','Produce','lemon','lemons','par',10,'Kitchen Coolroom','',false,3),
  ('Gold Class Kitchen','Fridge 1','Shredded cheese','Dairy','kg','kg','par',2.5,'Kitchen Coolroom','Estimate the open tub to the nearest 0.5 kg.',true,4),
  ('Gold Class Kitchen','Fridge 2','Milk','Dairy','2 L bottle','2 L bottles','par',6,'Kitchen Coolroom','',false,1),
  ('Gold Class Kitchen','Fridge 2','Butter portions','Dairy','tub','tubs','par',2,'Kitchen Coolroom','',false,2),
  ('Gold Class Kitchen','Fridge 2','Aioli','Sauces','squeeze bottle','squeeze bottles','par',3,'Kitchen Coolroom','Check the use-by label. Bin anything past its date.',false,3),
  ('Gold Class Kitchen','Fridge 2','Chicken tenders','Proteins','pack','packs','par',4,'Kitchen Freezer Room','Move to Fridge 2 to thaw for tomorrow.',false,4),
  ('Gold Class Kitchen','Freezer 1','Fries','Frozen','bag','bags','par',6,'Kitchen Freezer Room','',false,1),
  ('Gold Class Kitchen','Freezer 1','Brioche buns','Bakery','pack','packs','par',4,'Kitchen Freezer Room','',false,2),
  ('Gold Class Kitchen','Freezer 1','Vanilla ice cream','Desserts','tub','tubs','par',2,'Kitchen Freezer Room','',false,3),
  ('Gold Class Kitchen','Dry storage shelf','Tomato sauce','Sauces','bottle','bottles','par',4,'Kitchen Dry Storage','',false,1),
  ('Gold Class Kitchen','Dry storage shelf','Takeaway containers','Packaging','sleeve','sleeves','par',3,'Kitchen Dry Storage','',false,2),
  ('Gold Class Kitchen','Dry storage shelf','Cleaning cloths','Cleaning','pack','packs','manual',null,'Kitchen Dry Storage','Only request more if less than one pack is left.',false,3),
  ('Gold Class Bar','Bar fridge','Stone & Wood Pacific Ale','Beer','bottle','bottles','par',12,'Alcohol Storeroom','New stock goes behind cold stock.',false,1),
  ('Gold Class Bar','Bar fridge','Heineken','Beer','bottle','bottles','par',12,'Alcohol Storeroom','',false,2),
  ('Gold Class Bar','Bar fridge','Sparkling wine piccolo','Wine','bottle','bottles','par',8,'Alcohol Storeroom','',false,3),
  ('Gold Class Bar','Bar fridge','Lemonade','Soft drinks','can','cans','par',12,'Main Dry Store','',false,4),
  ('Gold Class Bar','Back shelf','Stone & Wood Pacific Ale','Beer','bottle','bottles','par',6,'Alcohol Storeroom','Back-up stock for the bar fridge.',false,1),
  ('Gold Class Bar','Back shelf','House red','Wine','bottle','bottles','par',4,'Alcohol Storeroom','',false,2),
  ('Gold Class Bar','Back shelf','Tonic water','Mixers','bottle','bottles','par',12,'Main Dry Store','',false,3),
  ('Gold Class Bar','Spirits & syrups','Vodka','Spirits','bottle','bottles','par',2,'Alcohol Storeroom','Count a bottle under half full as 0.5.',true,1),
  ('Gold Class Bar','Spirits & syrups','Sugar syrup','Syrups','bottle','bottles','par',2,'Bar Back of House','',false,2),
  ('Gold Class Bar','Spirits & syrups','Limes','Garnishes','lime','limes','manual',null,'Kitchen Coolroom','Ask the kitchen before taking limes.',false,3),
  ('Gold Class Bar','Glassware & napkins','Wine glasses','Glassware','rack','racks','routine',null,'Bar Back of House','Refill the wine glass rack from the glass washer. Polish each glass and remove any that are chipped.',false,1),
  ('Gold Class Bar','Glassware & napkins','Cocktail napkins','Consumables','pack','packs','par',3,'Bar Back of House','',false,2),
  ('Candy Bar','Confectionery stand','Pods','Confectionery','packet','packets','manual',null,'Candy Bar Back of House','',false,1),
  ('Candy Bar','Confectionery stand','Maltesers','Confectionery','packet','packets','manual',null,'Candy Bar Back of House','',false,2),
  ('Candy Bar','Confectionery stand','Skittles','Confectionery','packet','packets','manual',null,'Candy Bar Back of House','',false,3),
  ('Candy Bar','Choc-top freezer','Choc-tops (all flavours)','Frozen','box','boxes','routine',null,'Candy Bar Back of House','Bring out the choc-top flavour boxes and replenish the display. Keep each flavour in its labelled row.',false,1),
  ('Candy Bar','Cups & syrups','Large cups','Cups','sleeve','sleeves','par',4,'Candy Bar Back of House','',false,1),
  ('Candy Bar','Cups & syrups','Medium cups','Cups','sleeve','sleeves','par',4,'Candy Bar Back of House','',false,2),
  ('Candy Bar','Cups & syrups','Chocolate syrup','Syrups','bottle','bottles','par',2,'Candy Bar Back of House','',false,3),
  ('Candy Bar','Cups & syrups','Large popcorn boxes','Packaging','sleeve','sleeves','par',3,'Main Dry Store','',false,4)
),
new_products as (
  insert into products (department_id, category_id, name, unit_singular, unit_plural, method, allow_decimal,
                        instructions, default_location_id, sort_order, is_sample)
  select distinct on (d.id, s.product)
         d.id, c.id, s.product, s.unit_s, s.unit_p, s.method, s.dec, s.instructions, l.id, s.ord, true
  from s
  join departments d on d.name = s.dept
  left join categories c on c.department_id = d.id and c.name = s.category
  left join storage_locations l on l.name = s.location
  where not exists (select 1 from products p where p.department_id = d.id and p.name = s.product)
  order by d.id, s.product, s.ord
  returning id, department_id, name, instructions
),
all_products as (
  select id, department_id, name, instructions from new_products
  union all
  select id, department_id, name, instructions from products
)
insert into product_placements (product_id, check_area_id, par_level, instructions, sort_order)
select p.id, a.id, s.par::numeric,
       case when s.instructions <> '' and s.instructions <> p.instructions then s.instructions end,
       s.ord
from s
join departments d on d.name = s.dept
join all_products p on p.department_id = d.id and p.name = s.product
join check_areas a on a.department_id = d.id and a.name = s.area
on conflict (product_id, check_area_id) do nothing;
