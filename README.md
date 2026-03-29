# Greg Tracker

Greg Tracker is a web app for small-business bookkeeping and project-level financial tracking.  
It combines manual data entry, AI-assisted receipt extraction, Excel import/export, and a quote-request pipeline in one flow.

## Source code (GitHub)

Repository: [github.com/vsangiovanni/racketty_boom_dashboard](https://github.com/vsangiovanni/racketty_boom_dashboard)

## What is new (recent)

- **Public branding:** default logo is `frontend/assets/landing/logo.svg`. `frontend/js/brand-defaults.js` exposes `GREG_TRACKER_DEFAULT_LOGO_URL` for the sidebar, login, and Settings preview when no custom logo is stored in the database.
- **Quote requests module:** `frontend/quote-requests.html` — managers/admins manage leads (filters, full detail, internal notes). Public intake remains `frontend/quote.html`.
- **Projects:** tabs **Active / Completed / All**; KPIs and chart follow the selected view; quick **complete** / **reopen** actions; project details page has the same status actions.
- **Deploy root:** repository root has `package.json` (all runtime deps), `server.js` (`require('./backend/server.js')`), and `npm start` for a single install — matches Hostinger Node detection (`server.js`, Express).
- **Packaging:** `scripts/pack-hostinger.ps1` builds `hostinger-deploy.zip` (POSIX paths in the zip, validates JSON, excludes `node_modules`, duplicate `backend/package.json` in archive, local `.env`, etc.).
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
- **Shared nav / default logo:** `frontend/js/app-nav.js`, `frontend/js/brand-defaults.js`.

## Repository guide

- `backend/` — API, auth, schema bootstrap, imports, receipts.
- `frontend/` — screens, UI, in-app help.
- `database/` — SQL references / migrations.
- `scripts/` — `pack-hostinger.ps1` for production zip.
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

1. From the repo root, generate one archive (overwrites the same file; the zip is listed in `.gitignore`):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pack-hostinger.ps1
   ```

2. Upload **`hostinger-deploy.zip`**. Zip root must include **`package.json`**, **`server.js`**, **`backend/`**, **`frontend/`**, etc. (no `node_modules`; do not commit secrets — the script skips `backend/.env` and production env files; configure variables in hPanel or place `backend/.env.production` on the server only there).

3. In hPanel (**Websites → your site → Node.js**): **Application startup file** `server.js`, install command `npm install`, start `npm start` (or Hostinger’s Express preset). Set **environment variables** to match `backend/.env.example` (especially `DB_*`, `APP_BASE_URL`, `NODE_ENV=production`, and SMTP / `QUOTE_*` if you use quote emails).

4. **Automated deploy (optional):** if you use the Hostinger API from Cursor (MCP `user-hostinger-mcp`), the tool **`hosting_deployJsApplication`** accepts the same zip path (`archivePath`) and your site **domain**. After upload, check deployment status with **`hosting_listJsDeployments`**. If the API is not configured, use hPanel **Upload** / **Deploy** for the archive.

5. **Windows path tip:** use forward slashes for tool paths, e.g. `c:/Users/.../hostinger-deploy.zip`.

6. After a deploy, do a hard refresh or wait for the service worker (`sw.js`) to update so the latest `logo.svg` and precached assets load.

## Notes

- Schema updates run on startup via `ensureSchema()` in the backend.
- Help and static routes are public where needed so the manual works from the login page.
- Footer line is configured in `frontend/js/app-shell.js`.
