# Village Restock

A guided restocking app for cinema staff. Staff pick a department, check each physical area, and get one collection list grouped by storeroom. Supervisors manage products and par levels in an admin area.

This is an internal tool. Products and par levels in `db/seed/sample_data.sql` are examples only.

## How it fits together

| Part | What it does |
|---|---|
| **Next.js** (this repo), hosted on **Vercel** | The staff app, the admin screens, and the server code that checks every request. |
| **Supabase Postgres** (Sydney region) | The shared database. The browser never connects to it directly; only the server does, using a private connection string. |
| **The device's own database** (IndexedDB) | A copy of the product catalogue, so restocking keeps working without Wi-Fi. Phase 2 adds offline restock sessions. |

Access:

- **Staff** enter a shared staff access code once per device. Changing the code signs out every staff device.
- **Admins** (supervisors) sign in with an email and password. Only admins can change products, par levels or settings.
- Repeated wrong codes or passwords are blocked for 15 minutes.
- No personal staff details are stored. Phase 2 will record an optional first name or initials against restock work.

## Set up (one time)

### 1. Supabase

1. Create a free account at supabase.com, then create a **New project**.
   - Name: `village-restock`
   - Region: **Oceania (Sydney)**
   - Choose a strong database password and store it in a password manager.
2. When the project is ready, open **SQL Editor**, then **New query**.
3. Paste the whole of `db/migrations/001_initial_schema.sql` and click **Run**.
4. Optional: to try the app with example products, run `db/seed/sample_data.sql` the same way. You can remove the sample data later from Admin > Overview.
5. Go to **Project Settings > Database > Connection string**, choose **Transaction pooler** and copy the URI. This is your `DATABASE_URL`. Replace `[YOUR-PASSWORD]` with the database password from step 1.

### 2. Vercel

1. Sign in to vercel.com with GitHub, then choose **Add New > Project** and import this repository.
2. Before deploying, open **Environment Variables** and add the three values described in `.env.example`:
   - `DATABASE_URL`: from Supabase step 5.
   - `SESSION_SECRET`: a long random value.
   - `ADMIN_SETUP_CODE`: a long random value you'll type once.
3. Open **Settings > Functions** and set **Function Region** to **Sydney (syd1)**, so the app runs next to the database.
4. Click **Deploy**.

### 3. First sign-in

1. Open `https://<your-app>.vercel.app/admin/setup`, enter the `ADMIN_SETUP_CODE` and create your admin account. This page stops working once an admin exists.
2. In **Admin > Access & settings**, set the **staff access code**.
3. On each iPad, open the app in **Safari**, enter the staff code, then tap **Share > Add to Home Screen**.

## Local development

You need Node 20 or newer and a PostgreSQL database (a local one, or a separate Supabase project for testing).

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate           # or: npm run db:seed  (schema + sample data)
npm run dev
```

Checks:

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
src/app/admin/        Admin screens
src/components/       Shared interface pieces
```

## Build phases

- [x] **Phase 1 – Foundation**: database, staff and admin access, home screen, admin catalogue management, product data cached on the device.
- [ ] **Phase 2 – Core restocking**: Full and Quick Restock, area checking, collection list, offline-first saving.
- [ ] **Phase 3 – Reliability**: shared sessions across devices, conflict handling, shortages, summaries.
- [ ] **Phase 4 – Refinement**: reference photos, CSV import/export, installable offline app shell, iPad testing.
