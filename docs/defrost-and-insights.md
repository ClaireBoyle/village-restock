# Defrost Planner and Stock Insights: plan

This extends Village Restock. Nothing existing is rebuilt.

## What exists today (assessed)

| Area | Today | Used for |
|---|---|---|
| Restock records | `restock_sessions`, `session_items` (count / requested / collected, shortfall reason, flag), `session_areas` | Defrost-independent history; Insights |
| Shortages | `shortages` (confirmed "not enough in storeroom" + flagged), with day and product | Recurring-shortage detection |
| Offline | Device database (IndexedDB) + outbox of small "ops" applied once on the server (`/api/sync`) | Defrost Planner entries use the same path |
| Catalogue | Downloaded whole to each device, versioned | Defrost items are added to it, so the planner works offline |
| Admin | Signed-in admins only (middleware + server checks) | Defrost setup, Stock Insights |

## 1. Exception-based restocking (Gold Class Bar, Candy Bar)

Staff already sign off closing in Operandio, so the app should not demand a tick on every product.

- **"Staff enter what they need"** products and **routine tasks**: a blank means *not entered*. It no longer blocks **Finish restock**, isn't treated as "finished with exceptions", and isn't listed in the manager email.
- **Blank still differs from 0.** Blank = not entered, 0 = checked and nothing needed. Both are kept in the data and the record.
- **Target-level (par) products** (mostly Gold Class Kitchen) still need a count before finishing cleanly. That keeps kitchen consistency, as you asked.
- No mandatory area buttons. An area still completes by itself when every product has an answer, and Skip is still available.

## 2. Defrost Planner (Stage 1)

A separate, **optional** tool. It sits beside Kitchen Restock and is not a step before it.

- **Where:** the Gold Class Kitchen page shows two cards, **Defrost Planner** (labelled *Recommended*) and **Kitchen Restock**, each usable at any time and in either order. There are no prerequisites, blocking screens, redirects or acknowledgements. The planner appears for any department with defrost items set up.
- **Kitchen reminder:** a compact, non-blocking line at the top of Kitchen Restock, with an optional link to the planner. It can be hidden for that restock. Restock progress is saved on the device, so visiting the planner loses nothing.
- **Manager setup** (Admin → Defrost Planner), per product:
  - name and unit;
  - expected demand (a default, plus optional per-weekday values) and a safety buffer;
  - pack increment and minimum practical quantity;
  - **approved thawing method** and **minimum thaw time**;
  - **usable life after thawing**;
  - food-safety notes.
- **Next service time** is a setting (default 11:00 the next day).
- **Staff enter, per item:** usable chilled stock and stock already thawing and ready in time (a quick **None** button for 0), plus an optional ± demand adjustment.
- **Calculation** (pure function, unit-tested):

  `suggested = max(0, expected demand + adjustment + buffer − usable chilled − already thawing)`

  It is then rounded **up** to the pack increment and raised to the minimum if above 0. Each item shows the working, e.g. `24 expected + 4 buffer − 10 chilled − 4 thawing = 14`.
- **Safeguards:**
  - **Missing stock is never treated as 0.** If chilled or thawing stock hasn't been entered, the item shows *Needs a count* and no suggestion.
  - **Too late to thaw safely:** if now + the approved thaw time is after the next service, a warning replaces the number. The app never shortens a thaw time or suggests room-temperature thawing.
  - **Shelf life:** if thawed stock would pass its usable life before the service starts, it shows a warning instead of a quantity.
  - The app never changes safety settings by itself.
- **Recording:** staff record **Defrosting now** (defaults to the suggestion, editable). Optional, for the service just finished: **ran out** and **discarded** quantity with a reason. Nothing else is required.

## 3. Manager Stock Insights (Stage 2)

Built from records the app already holds, plus the planner's optional entries. It is read-only: **it never orders stock or changes targets.** Every alert says why it appeared.

| Signal | Rule (thresholds editable) | Data |
|---|---|---|
| **Recurring storeroom shortage** | Confirmed "not enough in storeroom" on **≥ 3 separate days in 7** | `shortages` + `session_items` (requested vs collected) |
| **High turnover** (not a problem) | Needed on **≥ 5 of the last 7** restock days, without recurring shortages | `session_items` |
| **Demand may be outpacing orders** | High turnover **and** at least one confirmed shortage | both |
| **Not collected for other reasons** | No time / couldn't access on ≥ 3 days (not a stock problem) | `session_items` |
| **Defrost shortfall** | "Ran out" recorded in the planner on ≥ 3 days | planner |
| **Over-defrosting / waste** | Discarded quantity recorded on ≥ 2 days (only confirmed waste) | planner |

The dashboard shows attention items first, then high turnover, defrost and waste, and a 14-day trend of shortage days.

## 4. Demand-based defrosting (Stage 3: groundwork only)

- Per-weekday expected demand, set by managers, so a Saturday target can be higher than a Monday one.
- On each defrost item, the admin page shows transparent history: average defrosted, discarded and ran-out counts by weekday once there are at least 3 records. It changes nothing automatically.
- **Not built (needs reliable data first):** point-of-sale or attendance feeds, release calendars, automatic forecasts. Restock requests are **not** treated as sales or consumption.

## Database changes (migration `006_defrost_planner.sql`)

- `defrost_items`: department-scoped setup, as above.
- `defrost_plans`: one per department per service date.
- `defrost_entries`: per plan and item (chilled, thawing, adjustment, suggested, defrosting, ran out, discarded with reason, who and when).
- Row-level security on, with no public access (same as all tables). Only the app's server reads and writes them. Staff writes go through the existing sync endpoint, and admin pages require an admin sign-in.

## Assumptions to confirm with the kitchen team

1. **Next service time.** I assumed 11:00 the next day for "ready in time" checks. Is that right for Gold Class Kitchen?
2. **Thaw method and times** come from your existing food-safety procedures. A manager must enter them; the app ships with none, and items without a thaw time show a warning.
3. **Usable life after thawing** is per product, from your procedures.
4. **Who may adjust.** Any closer can record what they actually put in to defrost and add a demand adjustment, and both are recorded with their name. Targets and safety settings are admin-only. Tell me if adjustments should be admin-only.
5. **Which items** appear in the planner: only those a manager adds. The planner doesn't use the restock catalogue automatically.
