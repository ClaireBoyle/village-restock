# Village Restock

A guided restocking app for cinema staff. Staff pick a department, check each physical area, and get one collection list grouped by storeroom. Supervisors manage products and par levels in an admin area.

Live app: https://village-restock.vercel.app (keep this address private).

This is an internal tool. Products and par levels in `db/seed/sample_data.sql` are examples only.

## How it fits together

| Part | What it does |
|---|---|
| **Next.js** (this repo), hosted on **Vercel** | The staff app, the admin screens, and the server code that checks every request. |
| **Supabase Postgres** (Sydney region) | The shared database. The browser never connects to it directly; only the server does, using a private connection string. |
| **The offline service worker** (`public/sw.js`) | Saves the app itself, each department page and reference photos on the device, so the app opens with no connection. Admin pages are never saved. |
| **The device's own database** (IndexedDB) | A copy of the product catalogue and every restock entry. Changes are saved here first, queued in an outbox, and uploaded when online. Each change has its own id so it is never applied twice. |

Access:

- **Staff screens are open to anyone with the link.** There are no staff accounts or codes, so keep the web address private. Search engines are told not to list the app.
- **The admin area** (products, par levels, settings) has no visible link. To open it, press and hold the logo on the home screen for 2 seconds, or add `/admin` to the address. It always asks for an admin email and password.
- Repeated wrong admin passwords are blocked for 15 minutes. Admin sign-ins end after 12 hours, and the home screen reminds an admin to sign out before handing a shared iPad back to staff.
- No personal staff details are stored. Phase 2 will record an optional first name or initials against restock work.

## Set up (one time)

### 1. Supabase

1. Create a free account at supabase.com, then create a **New project**.
   - Name: `village-restock`
   - Region: **Oceania (Sydney)**
   - Choose a strong database password and store it in a password manager.
2. When the project is ready, open **SQL Editor**, then **New query**.
3. Paste the whole of `db/migrations/001_initial_schema.sql` and click **Run**. Then do the same for each later file in `db/migrations/` in number order (`002_conflicts.sql`, `003_...`, `004_...`).
4. Optional: to try the app with example products, run `db/seed/sample_data.sql` the same way. You can remove the sample data later from Admin > Overview.
5. Go to **Project Settings > Database > Connection string**, choose **Transaction pooler** and copy the URI. This is your `DATABASE_URL`. Replace `[YOUR-PASSWORD]` with the database password from step 1.

### 2. Vercel

1. Sign in to vercel.com with GitHub, then choose **Add New > Project** and import this repository.
2. Before deploying, open **Environment Variables** and add the three values described in `.env.example`:
   - `DATABASE_URL`: from Supabase step 5.
   - `SESSION_SECRET`: a long random value.
   - `ADMIN_SETUP_CODE`: a long random value you'll type once.
   - Optional, for the automatic manager email: either `RESEND_API_KEY` (from resend.com) or `SMTP_USER` + `SMTP_PASS` (an email account and its app password, e.g. Gmail). `EMAIL_FROM` sets the sender name and address. Then set the address and switch it on in Admin > Access & settings.
3. Click **Deploy**. The app runs in Sydney (next to the database), set by `vercel.json`.

### 3. First sign-in

1. Open `https://<your-app>.vercel.app/admin/setup`, enter the `ADMIN_SETUP_CODE` and create your admin account. This page stops working once an admin exists.
2. On each iPad, open the app's address in **Safari**, then tap **Share > Add to Home Screen**. Then work through `docs/ipad-checklist.md` (about 10 minutes per device).

## Local development

You need Node 20 or newer and a PostgreSQL database (a local one, or a separate Supabase project for testing).

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate           # or: npm run db:seed  (schema + sample data)
npm run dev
```

Checks (browser tests: see `tests/e2e/README.md`):

```bash
npm test            # calculation and validation tests
npm run typecheck
npm run lint
npm run build
```

## Project layout

```
db/migrations/        Database schema (run in order)
db/seed/              Optional sample data, clearly marked
scripts/migrate.mjs   Applies migrations to DATABASE_URL
src/middleware.ts     Blocks every page and API without a valid sign-in
src/lib/restock-math.ts   Pure restock calculations (shared by device and server) + tests
src/lib/server/       Database, sign-in and catalogue code (server only)
src/lib/client/       Device database and catalogue download (browser only)
src/app/actions/      Server actions; every admin change is validated here
src/app/admin/        Admin screens (incl. Spreadsheets: CSV import/export)
public/sw.js          Offline service worker
docs/                 iPad checklist
src/components/       Shared interface pieces
```

## Build phases

- [x] **Phase 1 – Foundation**: database, staff and admin access, home screen, admin catalogue management, product data cached on the device.
- [x] **Phase 2 – Core restocking**: Full and Quick Restock, area checking, collection list grouped by storeroom, shortages, Save and exit / Finish / Finish with exceptions, offline-first saving with an outbox, shared restocks across devices.
- [x] **Phase 3 – Reliability**: clashing counts from two devices are kept and resolved by a person, supervisor Restocks and Shortages screens (resolve with a note, copyable low-stock list), restocks left open past the cut-off marked Unfinished.
- [x] **Extras**: menu items to mark sold out per product; finished screen shows Out of stock / Running low; automatic manager email after each finished full restock, with optional staff comments.
- [x] **Simpler shortages**: Got fewer → set the amount → Confirm records "not enough in storeroom" (out of stock / running low) automatically; *Other reason* (couldn't access stock, interrupted, other) is recorded as Collection incomplete, never as a stock shortage. Footer counts lines *resolved*. Finish screen lists Stock shortages and Collection incomplete as compact rows. Admins can delete a product (history keeps it).
- [x] **Subheadings inside an area**: Admin → Arrange can put a small subheading above any product (e.g. *Mixers, Water & Milk*, *Beer, Cider & Hard Soda*); still one area, one list. Needs `db/migrations/011_placement_headings.sql`. One-off catalogue updates live in `db/updates/` (run them in Supabase after the migrations).
- [x] **Refill FOH (Gold Class Bar)**: a full restock becomes *Check FOH → Refill FOH → Check BOH → Collect → Finish*. Front-of-house products can be grabbed from an upstairs spot (BOH bar fridge, walk-in, cupboards): they're listed on Refill FOH by spot, not on the downstairs list. Where set, what's taken is suggested for that spot on Check BOH (staff keep, change or remove it; what they leave is final). A product can be counted in a different unit in one area (single bottles in the FOH fridge, packs in the BOH fridge). Needs `db/migrations/012_foh_pickups.sql`, then `db/updates/2026-11-gold-class-bar-refill-foh.sql`. Departments without pickups are unchanged.
- [x] **None on display (Candy Bar)**: collecting less than needed shows as *Low stock* with how many short, even when none was collected. At zero, a *None on display* button marks it *Out of stock* on Collect, Review, the manager email and the Shortages page. A department setting (Admin → Departments); other departments keep "none collected = Out of stock". Needs `db/migrations/013_none_on_display.sql` (turns it on for Candy Bar).
- [x] **Email after every restock (Candy Bar)**: a department setting (Admin → Departments) that emails managers after every finished restock, even when everything was collected ("all stocked"). Other departments only email when there's something to act on. Needs `db/migrations/014_email_every_restock.sql` (turns it on for Candy Bar) and the manager email switched on in Admin → Settings.
- [x] **Gold Class Bar Check FOH walk**: the Back bench follows the bench from the sink to the milkshake machine (Liqueurs & Vermouth → Cocktail Syrups & Mixers → Spirits → Red Wines → Milkshake Syrups & Flake, left to right), a Coffee cupboard area holds the sugar and overflow coffee stock, and Check FOH / Check BOH have one next action: *Done → next area* (fine with nothing entered), then *Refill FOH* / *Collect*. Skip sits at the end of each area. Containers use *Needs refill*. Data: `db/updates/2026-11-gold-class-bar-back-bench-walk.sql`.
- [x] **Gold Class Bar lap**: Check FOH follows the lap of the bar from the bar map: FOH freezer → Confection → Popcorn boxes → Back bench (sink → spirits & red wine) → Back shelves → FOH beer fridge → Milkshake station → Cups, Lids & Straws → Coffee cupboard (supplies, then the sugar at the coffee machine). Data: `db/updates/2026-11-gold-class-bar-foh-lap.sql` (after the back-bench script).
- [x] **Gold Class Bar Coffee cupboard**: Top shelf (coffee beans, hot chocolate, decaf, chai, matcha, Biscoff), Bottom shelf (lemon, lime and raspberry cordial, bitters, orange bitters, honey, hazelnut syrup), a collapsed Tea bags tab (five teas, by the packet) and the sugar at the coffee machine; all collected from the Alcohol storeroom. Data: `db/updates/2026-11-gold-class-bar-coffee-cupboard.sql` (after the lap script).
- [x] **Completed by**: the Finish screen has an editable *Completed by* name (prefilled with the run's name, shown even with no shortages). It's kept while the run is open or if finishing fails, saved on the finished restock (also offline), and shown on the finished screen, Admin → Restocks, the summary and the manager email. Needs `db/migrations/015_completed_by.sql`.
- [x] **Home: finished states**: a finished department has a thin green outline and *✓ Stocked*; with shortages, *✓ Done · N shortages* in amber (the same count as the Review screen). Candy Bar's line says which area had them.
- [x] **Gold Class Bar route, simplified**: steps read *Check the bar → Collect upstairs → Top up BOH → Collect downstairs → Finish*. The FOH bar fridge is part of the Back bench stop (after the spirits and red wine). On Collect upstairs, Got fewer records how many were actually there; only what was actually grabbed is suggested for its spot on Top up BOH (grabbed none → nothing suggested). Data: `db/updates/2026-11-gold-class-bar-bench-fridge-stop.sql`.
- [x] **Upstairs, one screen per spot**: Gold Class Bar is now *Check the bar → Upstairs → Collect downstairs → Finish*. At each upstairs spot (BOH bar fridge, Walk in fridge, Upstairs cupboards) staff *Grab for the bar* (tick, or Got fewer) and, on the same screen, *Bring up from downstairs*, where what they grabbed is already suggested. A spot with nothing to grab is just the top-up check; an empty downstairs list goes straight to Finish. Areas read *Checked · nothing needed* or *Unchecked*; an empty list while checks are pending says *Nothing added to the collection list*.
- [x] **Gold Class Kitchen Defrost**: *Defrost* is the first section of the Kitchen restock, one row per item. Staff tap **Pull** (and set how many) or **Not needed**; every row says where to *Grab* it, where to look *If empty* (where confirmed) and where to *Put* it. The collection list is grouped by freezer (Freezer 1, Freezer 2) with the same notes. Ready for admits: once an item has ready-stock targets by admits range (Admin → product → Defrost details), staff enter tomorrow's Gold Class admits once and count what's already ready or defrosting; the amount to pull is suggested (target − ready, never below 0, rounded up to the pulled unit, e.g. portions → 1 kg bags) and can be changed. Items without a target or unit conversion stay manual. Needs `db/migrations/016_defrost_rows.sql`; data: `db/updates/2026-11-gold-class-kitchen-defrost.sql`. The Kitchen restock then walks *Freezer 1 → Freezer 2 → Walk in fridge (upstairs) → Dry stock* (empty, ready for products): `db/updates/2026-11-gold-class-kitchen-upstairs-areas.sql`. Defrost stock is pulled on the Defrost screen (*Pull now*, freezer by freezer, tick or Got fewer); what was actually pulled is suggested on Freezer 1 / Freezer 2 under *Replace what you pulled*, to bring up from the downstairs walk-in freezer, and the collection list is the downstairs run: `db/updates/2026-11-gold-class-kitchen-defrost-pulls.sql`.
- [x] **Reset restock (admins)**: the ⋯ on a restock card (signed-in admins only) resets that restock on the server and every device, so a fresh one can start the same day. Changes still queued on offline devices are dropped, never uploaded. **Admin → Access & settings → Clear test activity** removes selected test restocks and Defrost Planner records before launch. Needs `db/migrations/010_restock_resets.sql`.
- [x] **Restock by area** (Candy Bar): staff pick one area, tap **+ Add** only on what's needed, collect and finish it, at any time and in any order. Each area restock is its own record (history, shortages and email name the area). Switch on per department in Admin; other departments keep the full restock. Storerooms can have a short collection reminder. Needs `db/migrations/009_area_restocks.sql`.
- [x] **Area sections**: an area can show other areas as sections on its screen (open, collapsed, or optional and never required), e.g. Back bench with Other FOH spirits and an optional Spirits cupboard. Same product in several sections = one collection line. Needs `db/migrations/008_area_sections.sql`.
- [x] **Defrost Planner and Stock Insights**: optional Defrost Planner beside Kitchen Restock (manager-set targets and approved thawing times, safe suggestions, works offline), exception-based restocking for staff-entered products, and a manager Stock Insights dashboard. See `docs/defrost-and-insights.md`. Needs `db/migrations/006_defrost_planner.sql`.
- [x] **Redesign for real shifts**: products listed in the order staff physically find them (set per area in Admin > Products > *Arrange order*), compact rows with − / number / + controls (blank = not checked, 0 = nothing needed), instructions repeated across products shown once per area, compact picking list grouped by storeroom, slim header and bottom bar on phones.
- [x] **Phase 4 – Refinement**: reference photos for products and areas, spreadsheet (CSV) import/export, installable offline app (opens with no connection), iPad checklist in `docs/ipad-checklist.md`.
