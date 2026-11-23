-- Gold Class Kitchen: the restock in the order staff stock it, with refills as one-tap tasks.
-- Safe to run more than once. Run AFTER db/migrations/018_refills_and_linked_rows.sql and the earlier
-- Gold Class Kitchen scripts (…-freezers.sql and …-walk-in-shelves.sql). Only touches Gold Class Kitchen.
--
--   Defrost → Freezer 1 → Freezer 2 → Chest freezer → Walk in fridge → Dry stock   (Freezer 1 first since …-freezer-1-first.sql)
--
-- Freezer 2, in two sections:
--   Refill working drawers and tubs   Refilled · Already full · Needs stock (the task only: no amount,
--                                     never on the collection list), with the refill source shown:
--       Chicken tenders (the drawer)               tender box in Freezer 2, lower left
--       Vegetarian spring rolls, prawn twisters    spare boxes in Freezer 2, lower left
--       Arancini, nuggets, carrot pieces, lasagna croquettes, beef dumplings, fish
--                                                  their spare stock in Freezer 2, lower right
--       (Portioned lamb, cauliflower popcorn and Fisherman's Baskets are portioned in morning prep:
--        see 2026-11-gold-class-kitchen-portion-prep.sql)
--       Fries tub                                  source to be confirmed
--   Check remaining spare stock       after refilling: enter the total needed from downstairs
--       Lower left, Lower right, and the upper items with no spare upstairs (grilled chicken, LG buns, wedges)
-- Freezer 1 (after Freezer 2): its compartments are the overflow check.
-- Walk in fridge: desserts and burger buns show what's already planned in Defrost, and edit that same total.
-- Products and rows are moved, never copied; manual quantities, no pars or conversions.
do $$
declare
  dept uuid := (select id from departments where lower(name) = 'gold class kitchen');
  defrost uuid; f1 uuid; f2 uuid; chest uuid; walk uuid; refill uuid; spare uuid; a uuid; k int; i int; p uuid; pl uuid; norm text;
  oldsecs uuid[];
  -- Refill rows: product, source, note beside it ('' = keep)
  refills text[][] := array[
    ['Chicken Tenders', 'Tender box in Freezer 2, lower left', 'The drawer labelled "Southern Fried Chicken"'],
    ['Vegetarian Spring Rolls', 'Spare boxes in Freezer 2, lower left', ''],
    ['Prawn Twisters', 'Spare boxes in Freezer 2, lower left', ''],
    ['Arancini', 'Spare arancini in Freezer 2, lower right', ''],
    ['Nuggets', 'Spare nuggets in Freezer 2, lower right', ''],
    ['Carrot Pieces', 'Spare carrot pieces in Freezer 2, lower right', ''],
    ['Lasagna Croquettes', 'Spare lasagna bites in Freezer 2, lower right', ''],
    ['Beef Dumplings', 'Boxed dumplings in Freezer 2, lower right', ''],
    ['Fish', 'Spare battered fish in Freezer 2, lower right', ''],
    ['Fries', 'Source to be confirmed', 'The refillable fries tub']
  ];
  -- Spare stock check: product, heading (starts a group), from which old compartment ('ll', 'lr', 'ur')
  spares text[][] := array[
    ['Chicken Tenders', 'Lower left', 'll'],
    ['Vegetarian Spring Rolls', '', 'll'],
    ['Prawn Twisters', '', 'll'],
    ['Chicken Burger Thighs', '', 'll'],
    ['Churros', '', 'll'],
    ['Bar Juices', '', 'll'],
    ['Frozen Berries', '', 'll'],
    ['Arancini', 'Lower right', 'lr'],
    ['Nuggets', '', 'lr'],
    ['Carrot Pieces', '', 'lr'],
    ['Lasagna Croquettes', '', 'lr'],
    ['Beef Dumplings', '', 'lr'],
    ['Fish', '', 'lr'],
    ['Zucchini Wedges', '', 'lr'],
    ['Frozen Cheeses', '', 'lr'],
    ['Grilled Chicken', 'Upper right (no spare upstairs)', 'ur'],
    ['LG Buns', '', 'ur'],
    ['Classic Potato Wedges', '', 'ur']
  ];
  -- Old compartment names
  oldname text;
begin
  if dept is null then raise notice 'Gold Class Kitchen not found: nothing changed'; return; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'product_placements' and column_name = 'refill_source') then
    raise exception 'Run db/migrations/018_refills_and_linked_rows.sql first';
  end if;
  defrost := (select id from check_areas where department_id = dept and active and parent_area_id is null and lower(name) = 'defrost' limit 1);
  f1 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer1' limit 1);
  f2 := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'freezer2' limit 1);
  chest := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'chestfreezer' limit 1);
  walk := (select id from check_areas where department_id = dept and active and parent_area_id is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in ('walkinfridge', 'walkinfridgeupstairs') limit 1);
  if defrost is null or f1 is null or f2 is null then raise exception 'Run the earlier Gold Class Kitchen scripts first (…-defrost, …-upstairs-areas, …-freezers)'; end if;

  -- 1. Walking order: Defrost, Freezer 1, Freezer 2, Chest freezer, Walk in fridge, then the rest.
  k := 0;
  for a in select x from unnest(array[defrost, f1, f2, chest, walk]) x where x is not null loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;
  for a in select id from check_areas where department_id = dept and parent_area_id is null and not (id = any(array[defrost, f2, f1, chest, walk])) order by active desc, sort_order loop
    k := k + 1; update check_areas set sort_order = k where id = a;
  end loop;

  -- 2. Freezer 2's two sections.
  refill := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Refill working drawers and tubs'));
  if refill is null then insert into check_areas (department_id, name, sort_order) values (dept, 'Freezer 2 · Refill working drawers and tubs', 1) returning id into refill; end if;
  spare := (select id from check_areas where department_id = dept and lower(name) = lower('Freezer 2 · Check remaining spare stock'));
  if spare is null then insert into check_areas (department_id, name, sort_order) values (dept, 'Freezer 2 · Check remaining spare stock', 2) returning id into spare; end if;
  update check_areas set active = true, parent_area_id = f2, section_mode = 'open', sort_order = 1,
    guide_text = '' where id = refill;
  update check_areas set active = true, parent_area_id = f2, section_mode = 'open', sort_order = 2,
    guide_text = 'After refilling: check what spare stock is left and enter the total needed from downstairs.' where id = spare;
  oldsecs := array(select id from check_areas where department_id = dept and parent_area_id = f2 and not (id in (refill, spare)));

  -- 3. Refill rows: moved from the upper compartments (the same records), the source shown under each.
  for i in 1 .. array_length(refills, 1) loop
    norm := regexp_replace(lower(refills[i][1]), '[^a-z0-9]', '', 'g');
    p := (select id from products where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm order by created_at limit 1);
    if p is null then continue; end if;
    pl := (select id from product_placements where product_id = p and check_area_id = refill limit 1);
    if pl is null then
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and x.check_area_id = any(oldsecs) and lower(c.name) in (lower('Freezer 2 · Upper left'), lower('Freezer 2 · Upper right')) limit 1);
      if pl is not null then update product_placements set check_area_id = refill where id = pl;
      else insert into product_placements (product_id, check_area_id, sort_order) values (p, refill, i) returning id into pl; end if;
    end if;
    -- A tick records the task only: no pickup, no suggested replacement, no amount.
    update product_placements set sort_order = i, heading = null, par_level = null, refill_source = refills[i][2],
      pickup_area_id = null, pickup_suggest = false,
      instructions = case when refills[i][3] <> '' then refills[i][3] else instructions end
      where id = pl;
  end loop;

  -- 4. Spare stock check: the lower compartments, plus upper items with no spare upstairs.
  for i in 1 .. array_length(spares, 1) loop
    norm := regexp_replace(lower(spares[i][1]), '[^a-z0-9]', '', 'g');
    oldname := case spares[i][3] when 'll' then 'Freezer 2 · Lower left' when 'lr' then 'Freezer 2 · Lower right' else 'Freezer 2 · Upper right' end;
    p := (select id from products where department_id = dept and status = 'active' and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = norm order by created_at limit 1);
    if p is null then continue; end if;
    pl := (select id from product_placements where product_id = p and check_area_id = spare limit 1);
    if pl is null then
      pl := (select x.id from product_placements x join check_areas c on c.id = x.check_area_id
             where x.product_id = p and x.check_area_id = any(oldsecs) and lower(c.name) = lower(oldname) limit 1);
      if pl is not null then update product_placements set check_area_id = spare where id = pl;
      else insert into product_placements (product_id, check_area_id, sort_order) values (p, spare, i) returning id into pl; end if;
    end if;
    update product_placements set sort_order = i, heading = nullif(spares[i][2], ''), refill_source = null where id = pl;
  end loop;
  update product_placements x set instructions = 'Tender box'
    from products q where q.id = x.product_id and x.check_area_id = spare and regexp_replace(lower(q.name), '[^a-z0-9]', '', 'g') = 'chickentenders';

  -- Defrost pick-ups that pointed at an old compartment now point at the section holding that product.
  update product_placements d set pickup_area_id = (select x.check_area_id from product_placements x where x.product_id = d.product_id and x.check_area_id in (refill, spare) limit 1)
    where d.check_area_id = defrost and d.pickup_area_id = any(oldsecs)
      and exists (select 1 from product_placements x where x.product_id = d.product_id and x.check_area_id in (refill, spare));
  -- Old compartments left empty are switched off (kept for history).
  update check_areas c set active = false where c.id = any(oldsecs) and not exists (select 1 from product_placements x where x.check_area_id = c.id);

  -- 5. Freezer 1 is the overflow check, after refilling from it.
  update check_areas set guide_text = 'After refilling Freezer 2: check the overflow left here and enter the total needed from downstairs. What was pulled for defrost is suggested at the top.'
    where id = f1 and (trim(coalesce(guide_text, '')) = '' or guide_text like 'What was pulled for defrost is suggested at the top.%');
  update check_areas set guide_text = 'Refill the working drawers first, then check the spare stock.'
    where id = f2 and (trim(coalesce(guide_text, '')) = '' or guide_text like 'What was pulled for defrost is suggested at the top.%');
  update check_areas set guide_text = 'Defrost for tomorrow: enter how many to pull, or tap Not needed. (Refilling the freezer drawers is under Freezer 2.)'
    where id = defrost and (trim(coalesce(guide_text, '')) = '' or guide_text like 'For tomorrow: enter how many to pull%');

  -- 6. Walk in fridge: a Defrost item there shows (and edits) what's already planned in Defrost.
  if walk is not null then
    update product_placements x set linked_placement_id = d.id
      from product_placements d, check_areas c
      where c.id = x.check_area_id and (c.parent_area_id = walk or c.id = walk)
        and d.check_area_id = defrost and d.product_id = x.product_id and x.id <> d.id;
  end if;

  raise notice 'Freezer 2: % refills, % spare stock checks; % walk-in rows linked to Defrost; order: %',
    (select count(*) from product_placements where check_area_id = refill), (select count(*) from product_placements where check_area_id = spare),
    (select count(*) from product_placements x join check_areas c on c.id = x.check_area_id where (c.parent_area_id = walk or c.id = walk) and x.linked_placement_id is not null),
    (select string_agg(name, ' → ' order by sort_order) from check_areas where department_id = dept and active and parent_area_id is null);
end $$;
