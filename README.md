# Greg Tracker

Greg Tracker is a web app for small-business bookkeeping and project-level financial tracking.  
It combines manual data entry, AI-assisted receipt extraction, Excel import/export, and a quote-request pipeline in one flow.

## Source code (GitHub)

Repository: [github.com/vsangiovanni/racketty_boom_dashboard](https://github.com/vsangiovanni/racketty_boom_dashboard)

## What is new (recent)

- **Public branding:** default logo is `frontend/assets/landing/logo.svg`. `frontend/js/brand-defaults.js` exposes `GREG_TRACKER_DEFAULT_LOGO_URL` for the sidebar, login, and Settings preview when no custom logo is stored in the database.
- **Quote requests module:** `frontend/quote-requests.html` — managers/admins manage leads (filters, full detail, internal notes). Public intake remains `frontend/quote.html`.
- **Quote “unread” badge:** sidebar **Quote requests** shows an amber count for leads whose team detail was never opened (`team_first_viewed_at`); opening a row’s detail clears that lead from the count. Implemented via `GET /api/quote-requests/unread-count` and `frontend/js/quote-requests-badge.js` (periodic refresh ~90s).
- **Projects:** tabs **Active / Completed / All**; KPIs and chart follow the selected view; quick **complete** / **reopen** actions; project details page has the same status actions.
- **Deploy root:** repository root has `package.json` (all runtime deps), `server.js` (`require('./backend/server.js')`), and `npm start` for a single install — matches Hostinger Node detection (`server.js`, Express).
- **Locations:** `locations` table + `GET`/`POST` `/api/locations`; Manual Entry and Receipt Scan use a **dropdown** (`frontend/js/locations.js`) with **New** to save a city for reuse.
- **Packaging (recommended for Node deploy):** `npm run deploy:hostinger-zip` runs `scripts/package-for-hostinger.ps1`: `git archive` plus copies **`backend/.env.production` → `backend/.env`** inside the zip (file is gitignored; do not commit it). Output: `%TEMP%\greg-tracker-hostinger-deploy.zip`. Alternative: `scripts/pack-hostinger.ps1` → `hostinger-deploy.zip` with optional **`-IncludeProductionEnv`**.
- Dedicated project details: `frontend/project-details.html`.
- **Export Excel report** (`frontend/export-report.html`): period + optional project (`GET /api/export`).
- **Bulk Excel import** (`frontend/import.html`) with optional `project_id` on commit.
- Project analytics and AI insights endpoints (see backend README).
- Dashboard **Recent ledger** includes a **Project** column.

## Main user flow

1. Open `/` for the public landing; sign in at `login.html` (company PIN or team user + code).
2. Use `dashboard.html` for KPIs, charts, and recent transactions.
3. **Quote leads:** submit via `/quote.html`; manage via `/quote-requests.html` (managers/admins).
4. Add records: `add-record.html`, `upload.html` (AI scan), or `import.html` (Excel).
5. Export: `export-report.html` or dashboard **Export**.
6. Projects: `projects.html` (tabs + actions), details at `project-details.html?id=...`.
7. Settings: `settings.html` (admins). Help: `help.html?page=...` (includes `quote-requests`).

## Architecture

- **Backend:** Node.js + Express — main app in `backend/server.js`; root `server.js` loads it for deployment.
- **Database:** MySQL (`mysql2/promise`).
- **Frontend:** Static HTML + Tailwind CDN + vanilla JS.
- **PWA:** `frontend/manifest.webmanifest`, `frontend/sw.js` (bump `CACHE_NAME` when static assets change materially).
- **Shell helper:** `frontend/js/app-shell.js`.
- **Shared nav / default logo:** `frontend/js/app-nav.js`, `frontend/js/brand-defaults.js`, `frontend/js/quote-requests-badge.js` (Managers/Admins).

## Repository guide

- `backend/` — API, auth, schema bootstrap, imports, receipts.
- `frontend/` — screens, UI, in-app help.
- `database/` — SQL references / migrations.
- `scripts/` — `package-for-hostinger.ps1` (`npm run deploy:hostinger-zip`); `pack-hostinger.ps1` (alternate zip).
- `docs/en/` — extra English technical notes.

## Quick start (local)

1. Create a MySQL database (e.g. `greg_tracker`).
2. Copy `backend/.env.example` to `backend/.env` and set `DB_*` (and other vars as needed).
3. From the **repository root**:

```bash
npm install
npm start
```

4. Open **http://localhost:4000** (or the port set in `PORT`).

To run only from `backend/` (optional): `cd backend && npm install && npm start` — still uses `backend/server.js` directly.

## Deployment (Hostinger)

1. From the repo root, build the archive **with** `backend/.env` populated from your local `backend/.env.production` (required if hPanel env vars are empty; never commit these files):

   ```bash
   npm run deploy:hostinger-zip
   ```

   Creates **`%TEMP%\greg-tracker-hostinger-deploy.zip`** (Windows) with `git archive` + embedded `backend/.env`. Keep that zip private.

   **Alternative:** `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pack-hostinger.ps1` → **`hostinger-deploy.zip`** in the repo folder. To embed production env: add **`-IncludeProductionEnv`**.

2. Upload that zip (**`greg-tracker-hostinger-deploy.zip`** or **`hostinger-deploy.zip`**). Root must include **`package.json`**, **`server.js`**, **`backend/`**, **`frontend/`**, etc. (no `node_modules`).

3. In hPanel (**Websites → your site → Node.js**): **Application startup file** `server.js`, install command `npm install`, start `npm start` (or Hostinger’s Express preset). Set **environment variables** in hPanel **or** rely on **`backend/.env`** inside the uploaded zip (from `deploy:hostinger-zip`). For **internal quote alerts**, `QUOTE_NOTIFY_TO` accepts **several addresses** separated by commas or semicolons (same notification to each).

4. **Automated deploy (optional):** Hostinger MCP **`hosting_deployJsApplication`** with `archivePath` pointing at the zip from step 1 (e.g. `c:/Users/.../AppData/Local/Temp/greg-tracker-hostinger-deploy.zip`). Check status with **`hosting_listJsDeployments`**.

5. **Windows path tip:** use forward slashes for MCP paths, e.g. `c:/Users/.../greg-tracker-hostinger-deploy.zip`.

6. After a deploy, do a hard refresh or wait for the service worker (`sw.js`) to update so the latest `logo.svg` and precached assets load.

## Notes

- Schema updates run on startup via `ensureSchema()` in the backend.
- Help and static routes are public where needed so the manual works from the login page.
- Footer line is configured in `frontend/js/app-shell.js`.
