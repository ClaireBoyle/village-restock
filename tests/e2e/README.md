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
| `e2e-p2.js` | Full + Quick restock, par levels, offline saving and upload, collection, shortages, finish, manager email |
| `e2e-p3.js` | Two devices: clashing counts, handover, admin restocks/shortages, overnight roll-over |
| `e2e-p4.js` | Photos, spreadsheet import/export, installable offline app |
| `e2e-p5.js` | Redesign on a realistic Candy Bar layout. **First run** `psql "$E2E_DATABASE_URL" -f tests/e2e/candy-fixture.sql` after the reset. Physical order, area notes, zero vs unchecked, progress, picking list, admin arrange |
| `e2e-note.js` | Comments for managers (set `manager_email` + `manager_email_enabled` in app_settings first) |
| `name-test.js` | Staff name panel on a phone |

Screenshots go to `tests/e2e/out/` (not committed).
