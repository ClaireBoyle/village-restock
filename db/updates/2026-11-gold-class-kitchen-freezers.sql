-- Gold Class Kitchen: Freezer 1 and Freezer 2 by compartment, the chest freezer, and the Defrost
-- directions to match. Safe to run more than once. Only touches Gold Class Kitchen.
-- Run AFTER 2026-11-gold-class-kitchen-defrost.sql, -upstairs-areas.sql and -defrost-pulls.sql.
--
-- * Each compartment is a section on its freezer's screen ("Upper left", "Upper right", …; stored as
--   "Freezer 1 · Upper left" because area names are unique). The same product can be in several
--   compartments and freezers (e.g. arancini in Freezer 2 upper right and lower right).
-- * Everything is "staff enter" (manual) for now, also products reused from elsewhere in the Kitchen,
--   collected from the downstairs walk-in freezer.
--   Pars and admits targets come later. Units marked "to confirm" in the list below are best guesses.
-- * Chicken tenders: the upper-left drawer ("Southern Fried Chicken" label) is refilled from the box in
--   the lower left, so the drawer is on "Pull now" and what's taken from the box is suggested for the
--   box's top-up from downstairs.
-- * Defrost: pick-up directions now name the compartment. Desserts are pulled straight from the
--   downstairs walk-in freezer (on the collection list) into the upstairs walk-in fridge.
-- * Potato Coins → Potato Cakes; Meatballs and Puff Pastry are archived (off the lists; history kept).
-- * Existing products are reused by name (never duplicated). Instructions already changed in Admin are kept.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  f1 uuid; f2 uuid; chest uuid; defrost uuid; down uuid; f1s uuid; f2s uuid; cat uuid;
  sec uuid; area uuid; p uuid; pl uuid; i int; k int; a uuid;
  norm text;
  -- freezer, compartment, sort, note for staff (shown at the top of the compartment)
  comps text[][] := array[
    ['1', 'Upper left', '1', ''],
    ['1', 'Upper right', '2', ''],
    ['1', 'Lower left', '3', ''],
    ['1', 'Lower right', '4', 'Overflow stock, plus the naan and bao bun tubs.'],
    ['1', 'Fisherman''s Basket spares', '5', 'Spare potato cakes, calamari and onion rings for making up the Fisherman''s Basket portions kept in Freezer 2. Compartment to be confirmed.'],
    ['2', 'Upper left', '1', ''],
    ['2', 'Upper right', '2', ''],
    ['2', 'Lower left', '3', ''],
    ['2', 'Lower right', '4', '']
  ];
  -- freezer ('1', '2', 'c' chest freezer), compartment, product, unit (one), unit (more), direction beside the item
  items text[][] := array[
    ['1', 'Upper left', 'Vanilla Ice Cream', 'tub', 'tubs', ''],
    ['1', 'Upper left', 'Salted Caramel Ice Cream', 'tub', 'tubs', ''],
    ['1', 'Upper left', 'Coconut Ice Cream', 'tub', 'tubs', ''],
    ['1', 'Upper left', '7" Pizza Bases', 'base', 'bases', ''],
    ['1', 'Upper left', 'Gluten-Free Pizza Bases', 'base', 'bases', ''],
    ['1', 'Upper right', 'Buns (Portioned Tubs)', 'tub', 'tubs', ''],
    ['1', 'Upper right', 'Beef Patties', 'patty', 'patties', ''],
    ['1', 'Lower left', '9" Pizza Bases', 'base', 'bases', 'The labelled 9" Pizza Bases drawer'],
    ['1', 'Lower left', 'Focaccia Bread', 'piece', 'pieces', ''],
    ['1', 'Lower left', 'Pulled Beef (Bao)', 'bag', 'bags', 'Bottom shelf, beneath the pizza bases (1 kg bags)'],
    ['1', 'Lower right', 'Portioned Lamb', 'portion', 'portions', 'Overflow'],
    ['1', 'Lower right', 'Cauliflower Popcorn', 'portion', 'portions', 'Overflow'],
    ['1', 'Lower right', 'Naan Bread', 'piece', 'pieces', 'Lower-left tub'],
    ['1', 'Lower right', 'Bao Buns', 'bun', 'buns', 'Lower-right tub'],
    ['1', 'Fisherman''s Basket spares', 'Potato Cakes', 'bag', 'bags', ''],
    ['1', 'Fisherman''s Basket spares', 'Calamari', 'bag', 'bags', ''],
    ['1', 'Fisherman''s Basket spares', 'Onion Rings', 'bag', 'bags', ''],
    ['2', 'Upper left', 'Portioned Lamb', 'portion', 'portions', ''],
    ['2', 'Upper left', 'Chicken Tenders', 'bag', 'bags', 'Drawer labelled "Southern Fried Chicken". Refill it from the box in the lower left.'],
    ['2', 'Upper left', 'Vegetarian Spring Rolls', 'bag', 'bags', ''],
    ['2', 'Upper left', 'Lasagna Croquettes', 'bag', 'bags', ''],
    ['2', 'Upper left', 'Beef Dumplings', 'bag', 'bags', ''],
    ['2', 'Upper left', 'Nuggets', 'bag', 'bags', ''],
    ['2', 'Upper left', 'Prawn Twisters', 'bag', 'bags', ''],
    ['2', 'Upper right', 'Fisherman''s Basket', 'portion', 'portions', 'Prepared portions. Make more from the spare potato cakes, calamari and onion rings in Freezer 1.'],
    ['2', 'Upper right', 'Fish', 'portion', 'portions', ''],
    ['2', 'Upper right', 'Arancini', 'bag', 'bags', 'In the arancini drawer'],
    ['2', 'Upper right', 'Grilled Chicken', 'portion', 'portions', 'Above the arancini drawer. Usually 1 packet.'],
    ['2', 'Upper right', 'Cauliflower Popcorn', 'portion', 'portions', ''],
    ['2', 'Upper right', 'Carrot Pieces', 'bag', 'bags', ''],
    ['2', 'Upper right', 'LG Buns', 'pack', 'packs', ''],
    ['2', 'Upper right', 'Fries', 'bag', 'bags', 'The refillable fries tub'],
    ['2', 'Upper right', 'Classic Potato Wedges', 'bag', 'bags', 'To the right of the fries tub. Usually 3–4 bags, one open.'],
    ['2', 'Lower left', 'Chicken Tenders', 'bag', 'bags', 'The box (it refills the upper-left drawer)'],
    ['2', 'Lower left', 'Chicken Burger Thighs', 'piece', 'pieces', ''],
    ['2', 'Lower left', 'Churros', 'bag', 'bags', ''],
    ['2', 'Lower left', 'Bar Juices', 'bottle', 'bottles', ''],
    ['2', 'Lower left', 'Frozen Berries', 'bag', 'bags', ''],
    ['2', 'Lower left', 'Vegetarian Spring Rolls', 'bag', 'bags', ''],
    ['2', 'Lower left', 'Prawn Twisters', 'bag', 'bags', ''],
    ['2', 'Lower right', 'Zucchini Wedges', 'portion', 'portions', 'Portioned'],
    ['2', 'Lower right', 'Frozen Cheeses', 'pack', 'packs', ''],
    ['2', 'Lower right', 'Carrot Pieces', 'bag', 'bags', ''],
    ['2', 'Lower right', 'Arancini', 'bag', 'bags', ''],
    ['2', 'Lower right', 'Nuggets', 'bag', 'bags', ''],
    ['2', 'Lower right', 'Lasagna Croquettes', 'bag', 'bags', 'Lasagna bites'],
    ['2', 'Lower right', 'Beef Dumplings', 'bag', 'bags', 'Boxed dumplings'],
    ['2', 'Lower right', 'Fish', 'portion', 'portions', 'Battered fish, spare stock'],
    ['c', '', 'Fries', 'bag', 'bags', ''],
    ['c', '', 'Classic Potato Wedges', 'bag', 'bags', '']
  ];
  -- Defrost: product, pulled from (freezer, compartment; '' = downstairs walk-in freezer), where to grab it
  pulls text[][] := array[
    ['Pulled Beef (Bao)', '1', 'Lower left', 'Check the portioned beef in the under-salad-bar bench fridge first. If more is needed: 1 kg bag, Freezer 1 lower left, bottom shelf beneath the 9" pizza bases.'],
    ['Bao Buns', '1', 'Lower right', 'Freezer 1 lower right: the bao buns tub (lower-right tub)'],
    ['Beef Patties', '1', 'Upper right', 'Freezer 1 upper right'],
    ['Buns (Portioned Tubs)', '1', 'Upper right', 'Freezer 1 upper right'],
    ['9" Pizza Bases', '1', 'Lower left', 'Freezer 1 lower left: the labelled 9" Pizza Bases drawer'],
    ['Grilled Chicken', '2', 'Upper right', 'Freezer 2 upper right, above the arancini drawer (usually 1 packet)'],
    ['Naan Bread', '1', 'Lower right', 'Freezer 1 lower right: the naan bread tub (lower-left tub)'],
    ['Basque Cheesecake', '', '', 'Downstairs walk-in freezer'],
    ['Chocolate Mousse Cake', '', '', 'Downstairs walk-in freezer'],
    ['Sour Cherry Gel', '', '', 'Downstairs walk-in freezer'],
    ['Golden Crumb', '', '', 'Downstairs walk-in freezer'],
    ['Passionfruit Sponge', '', '', 'Downstairs walk-in freezer'],
    ['Raspberry Coulis', '', '', 'Downstairs walk-in freezer'],
    ['Salted Caramel Sauce', '', '', 'Downstairs walk-in freezer'],
    ['Brownie', '', '', 'Downstairs walk-in freezer'],
    ['Sticky Date', '', '', 'Downstairs walk-in freezer']
  ];
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  defrost := (select id from check_areas where department_id = dept and active and lower(name) = 'defrost' and parent_area_id is null limit 1);
  f1 := (select id from check_areas where department_id = dept and active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer1' and parent_area_id is null limit 1);
  f2 := (select id from check_areas where department_id = dept and active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer2' and parent_area_id is null limit 1);
  if defrost is null or f1 is null or f2 is null then
    raise exception 'Run 2026-11-gold-class-kitchen-defrost.sql and 2026-11-gold-class-kitchen-upstairs-areas.sql first';
  end if;
  down := (select id from storage_locations where active and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'walkinfreezer%' order by sort_order limit 1);
  if down is null then raise exception 'The downstairs walk-in freezer storeroom (e.g. "Walk in freezer(Downstairs)") must exist first'; end if;
  f1s := (select id from storage_locations where lower(name) = 'freezer 1');
  f2s := (select id from storage_locations where lower(name) = 'freezer 2');

  -- 1. Corrections to the draft list.
  update products set name = 'Potato Cakes' where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'potatocoins'
    and not exists (select 1 from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'potatocakes');
  update products set status = 'archived' where department_id = dept and status = 'active'
    and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('potatocoins', 'meatballs', 'meatball', 'puffpastry');

  -- 2. The chest freezer, after Freezer 2 (everything else keeps its order after it).
  chest := (select id from check_areas where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'chestfreezer' order by active desc limit 1);
  if chest is null then
    insert into check_areas (department_id, name, sort_order) values (dept, 'Chest freezer', 0) returning id into chest;
  end if;
  update check_areas set active = true, parent_area_id = null where id = chest;
  update check_areas set guide_text = 'Add only what needs topping up. It comes up from the downstairs walk-in freezer.'
    where id = chest and trim(coalesce(guide_text, '')) = '';
  k := 0;
  for a in select x from unnest(array[defrost, f1, f2, chest]) x loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;
  for a in select id from check_areas where department_id = dept and parent_area_id is null and not (id = any(array[defrost, f1, f2, chest])) order by active desc, sort_order loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;

  -- 3. The compartments, as sections on each freezer's screen.
  for i in 1 .. array_length(comps, 1) loop
    area := case comps[i][1] when '1' then f1 else f2 end;
    sec := (select id from check_areas where department_id = dept and lower(name) = lower(format('Freezer %s · %s', comps[i][1], comps[i][2])) limit 1);
    if sec is null then
      insert into check_areas (department_id, name, sort_order) values (dept, format('Freezer %s · %s', comps[i][1], comps[i][2]), comps[i][3]::int) returning id into sec;
    end if;
    update check_areas set active = true, parent_area_id = area, section_mode = 'open', sort_order = comps[i][3]::int where id = sec;
    update check_areas set guide_text = comps[i][4] where id = sec and trim(coalesce(guide_text, '')) = '' and comps[i][4] <> '';
  end loop;

  insert into categories (department_id, name, sort_order) select dept, 'Freezer', 2
    where not exists (select 1 from categories where department_id = dept and lower(name) = 'freezer');
  cat := (select id from categories where department_id = dept and lower(name) = 'freezer');

  -- 4. Every item, in its compartment (a product can be in several).
  for i in 1 .. array_length(items, 1) loop
    area := case items[i][1] when 'c' then chest
      else (select id from check_areas where department_id = dept and lower(name) = lower(format('Freezer %s · %s', items[i][1], items[i][2]))) end;
    norm := regexp_replace(lower(items[i][3]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm
          order by (status = 'active') desc, created_at limit 1);
    if p is null then
      insert into products (department_id, category_id, name, unit_singular, unit_plural, method, default_location_id, sort_order)
        values (dept, cat, items[i][3], items[i][4], items[i][5], 'manual', down, 500 + i) returning id into p;
    else
      -- Manual quantities for now (confirmed pars and admits targets come later).
      update products set status = 'active', method = 'manual', category_id = coalesce(category_id, cat),
        default_location_id = case when default_location_id is null or default_location_id in (f1s, f2s) then down else default_location_id end
        where id = p;
    end if;
    pl := (select id from product_placements where product_id = p and check_area_id = area limit 1);
    if pl is null and items[i][1] <> 'c' then
      -- Already on the freezer's own list (from the defrost-pulls script): move it into its compartment.
      pl := (select id from product_placements where product_id = p and check_area_id = case items[i][1] when '1' then f1 else f2 end limit 1);
      if pl is not null then update product_placements set check_area_id = area where id = pl; end if;
    end if;
    if pl is null then
      insert into product_placements (product_id, check_area_id, sort_order) values (p, area, i) returning id into pl;
    end if;
    -- Topped up from the downstairs walk-in freezer (a storeroom already chosen for this row in Admin is kept).
    update product_placements set sort_order = i, par_level = null, heading = null, location_id = coalesce(location_id, down),
      instructions = coalesce(nullif(trim(instructions), ''), nullif(items[i][6], ''))
      where id = pl;
  end loop;

  -- 5. Chicken tenders: the drawer is refilled from the box (what's taken is suggested for the box's top-up).
  update product_placements x set pickup_area_id = (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Lower left')),
      pickup_suggest = true
    from products p where p.id = x.product_id and p.department_id = dept and lower(p.name) = 'chicken tenders'
      and x.check_area_id = (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Upper left'));

  -- 6. Defrost: where each one is pulled from, and its replacement in that compartment.
  for i in 1 .. array_length(pulls, 1) loop
    norm := regexp_replace(lower(pulls[i][1]), '[^a-z0-9]', '', 'g');
    pl := (select x.id from product_placements x join products q on q.id = x.product_id
           where x.check_area_id = defrost and q.department_id = dept and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = norm limit 1);
    if pl is null then continue; end if;
    if pulls[i][2] = '' then
      -- Straight from the downstairs walk-in freezer (on the collection list), into the upstairs walk-in fridge.
      update product_placements set pickup_area_id = null, pickup_suggest = false, location_id = down,
        grab_note = pulls[i][4], fallback_note = null,
        put_note = coalesce(nullif(trim(put_note), ''), 'Upstairs walk-in fridge, right-hand dessert shelf')
        where id = pl;
      -- No longer pulled from (or topped up in) Freezer 1.
      delete from product_placements x using product_placements d
        where d.id = pl and x.product_id = d.product_id and x.check_area_id in (f1, f2);
    else
      sec := (select id from check_areas where department_id = dept and lower(name) = lower(format('Freezer %s · %s', pulls[i][2], pulls[i][3])));
      update product_placements set pickup_area_id = sec, pickup_suggest = true,
        location_id = case pulls[i][2] when '2' then coalesce(f2s, location_id) else coalesce(f1s, location_id) end,
        grab_note = pulls[i][4]
        where id = pl;
    end if;
  end loop;

  raise notice 'Gold Class Kitchen freezers: Freezer 1 % items, Freezer 2 % items, chest freezer % items; % archived',
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.parent_area_id = f1 or c.id = f1),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where c.parent_area_id = f2 or c.id = f2),
    (select count(*) from product_placements where check_area_id = chest),
    (select count(*) from products where department_id = dept and status = 'archived' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('potatocoins', 'meatballs', 'meatball', 'puffpastry'));
end $$;
