# Browser tests (Playwright)

Real-browser checks of the staff and admin screens, run against a local build and a **local test database** (never the live one: every run wipes the data).

```bash
# 1. A local Postgres database for tests, then:
export E2E_DATABASE_URL=postgres://vr:vr@localhost:5432/village_restock   # (default)
# 2. Build and start the app on port 3100 with DATABASE_URL pointing at that same test database
npm run build && npx next start -p 3100
# 3. Before EACH suite: reset the test database with schema + sample data
psql "$E2E_DATABASE_URL" -c "drop schema public cascade; create schema public;" && DATABASE_URL=$E2E_DATABASE_URL node scripts/migrate.mjs --seed
# 4. Run a suite
node tests/e2e/e2e-p2.js
```

| Suite | Covers |
|---|---|
| `e2e-p2.js` | Full + Stock top-up, par levels, offline saving and upload, collection, shortages, finish, manager email |
| `e2e-p3.js` | Two devices: clashing counts, handover, admin restocks/shortages, overnight roll-over |
| `e2e-p4.js` | Photos, spreadsheet import/export, installable offline app |
| `e2e-p5.js` | Redesign on a realistic Candy Bar layout. **First run** `psql "$E2E_DATABASE_URL" -f tests/e2e/candy-fixture.sql` after the reset. Physical order, area notes, zero vs unchecked, progress, picking list, admin arrange |
| `e2e-note.js` | Comments for managers (set `manager_email` + `manager_email_enabled` in app_settings first) |
| `name-test.js` | Staff name panel on a phone |
| `e2e-p6.js` | Defrost Planner (optional, offline, two devices, safety warnings), exception-based finishing, Stock Insights. **First** load `defrost-fixture.sql` then `candy-fixture.sql` after the reset |
| `e2e-p7.js` | Product photos from Open Food Facts, against a stand-in server. Start the app with `OFF_API_BASE=http://localhost:3199 OFF_IMAGE_HOSTS=localhost:3199` |
| `e2e-p8.js` | Gold Class Bar spirits: Back bench first, collapsible Other FOH spirits, optional Spirits cupboard, merged collection lines. **First** load `spirits-fixture.sql` after the reset |
| `e2e-p9.js` | Candy Bar area by area: pick an area, + Add / 0 / untouched, collect only that area (storeroom reminder once), finish, resume, offline, tablet and desktop. **First** load `candy-fixture.sql` then `candy-area-fixture.sql` after the reset |
| `e2e-p10.js` | Admin Reset restock (full, finished area, quick), two devices, queued offline changes, offline-started restocks, non-admin refused, offline admin, Clear test activity. **First** load `candy-fixture.sql` then `candy-area-fixture.sql` after the reset |
| `e2e-p11.js` | Gold Class Bar BOH bar fridge: applies `db/updates/2026-11-gold-class-bar-boh-fridge.sql` twice, checks the 24 products, order, two subheadings, storerooms, no duplicates; staff screen on phone and desktop; Arrange subheadings. **First** load `boh-fixture.sql` after the reset |
| `e2e-p12.js` | Gold Class Bar categories (live-shaped copy), Whipping Cream, Got fewer + Confirm (auto "not enough in storeroom"), Other reason, flag, change, "resolved" footer, compact Finish (no Ready panel, readable rows), phone/tablet/desktop. **First** load `gcbar-fixture.sql` after the reset |
| `e2e-p13.js` | Gold Class Bar route (Check the bar → Upstairs, one screen per spot → Collect downstairs): update script twice, five steps, FOH-only areas, FOH beer fridge (bottles vs packs), Refill FOH grouped by pickup spot (tick only), Check BOH suggestions (kept, changed to 3, removed, brought back), Kirks in packs, Still Water in slabs, downstairs list, clean finish, phone/tablet/desktop. **First** load `gcbar-refill-fixture.sql` after the reset |
| `e2e-p14.js` | Candy Bar None on display: Low stock with quantity short (also at zero), None on display → Out of stock and back, cleared when some is collected, Review rows, shortages recorded, manager email wording, a clean restock still emailed. **First** load `candy-fixture.sql` then `candy-area-fixture.sql` after the reset |
| `e2e-p15.js` | Gold Class Bar Check FOH: bench and lap scripts twice, the lap of the bar (Milkshake station after the FOH bar fridge, Coffee cupboard last), Done wrapping back to an area left open, Back bench stops and left-to-right order, the 11 added bottles, Done → next area (nothing entered), Skip, Needs refill, Refill FOH by source with instructions, 44px controls and one column on phone, same walk on iPad and laptop. **First** load `gcbar-refill-fixture.sql` after the reset |
| `e2e-p16.js` | Completed by (prefilled, shown with no shortages, kept when left in progress, saved, fresh for the next run, saved offline then uploaded) and Home finished states (✓ Stocked green outline; ✓ Done · 2 shortages amber; cards and Candy Bar line). **First** load `candy-fixture.sql` then `candy-area-fixture.sql` after the reset |
| `e2e-p17.js` | Gold Class Bar with nothing needed: Unchecked vs Checked · nothing needed, "Nothing added to the collection list" while checks are pending, upstairs spots with nothing to grab, straight to sign-off. **First** load `gcbar-refill-fixture.sql` after the reset |
| `e2e-p20.js` | Gold Class Bar None left here: the tick (only on items added to collect, off by default, undo, cleared when removed), Collect labels, Finish review (Out of stock first, Low stock · Still available, Top-up incomplete) with Change, one-tap full collection, shortages and email wording. **First** load `gcbar-refill-fixture.sql` after the reset |
| `e2e-p21.js` | A catalogue saved by an earlier release (e.g. a database update run before the new release went live) is replaced, even at the same version; same release and version is still "unchanged"; None left here then shows on a laptop. **First** load `gcbar-refill-fixture.sql` after the reset |
| `e2e-p22.js` | Stock Top-up in every department: + and a number with its unit in each row, on Your list above zero, edit the same entry, zero/− takes it off, no Add step, search/filter/scroll kept, area instructions once, phone and iPad, Kitchen saved to the server. **First** load `candy-fixture.sql` then `candy-area-fixture.sql` after the reset |
| `e2e-p23.js` | Kitchen Prep checklist: opened with no restock, grouped confirmed jobs, Unchecked → Ready / Needs prep, note, two devices on one service, Needs prep filter, Needs prep never on the opener's handover, Leave for morning on it (Done), next service fresh, Admin adds a job to both. After the reset (applies the Kitchen scripts) |
| `e2e-p24.js` | Gold Class Kitchen: one next action through every area (Continue / Done → next), the collection list only after Dry stock. After the reset (applies the Kitchen scripts) |
| `e2e-p25.js` | Candy Bar confection stand side by side: Side A / Side B switch (kept, saved, editable), one collection line with the split (kept after Got all), Got fewer with where the units go, Fill Side A / B before Finish, Stock Top-up switch. **First** load `candy-fixture.sql` then `candy-area-fixture.sql` after the reset |
| `e2e-stuck-lock.js` | A hung database connection holding a lock: the app says "Sync needs attention" (not "Offline") and uploads by itself once it clears |

Screenshots go to `tests/e2e/out/` (not committed).

`insights-fixture.sql` (after `defrost-fixture.sql`) adds a week of illustrative history for looking at Stock Insights.
