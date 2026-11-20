-- Gold Class Bar: SUPERSEDED. The FOH beer fridge is no longer part of the Back bench stop: it's its own
-- stop, straight before the BOH bar fridge (see 2026-11-gold-class-bar-beer-fridge-area.sql).
-- Running this file changes nothing (kept so older instructions that mention it stay safe).
do $$ begin
  raise notice 'Nothing changed: the FOH beer fridge is its own stop now (2026-11-gold-class-bar-beer-fridge-area.sql).';
end $$;
