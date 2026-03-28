# Greg Tracker

Greg Tracker is a web app for small-business bookkeeping and project-level financial tracking.  
It combines manual data entry, AI-assisted receipt extraction, Excel import/export, and a quote-request pipeline in one flow.

## What is new (recent)

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
- **PWA:** `frontend/manifest.webmanifest`, `frontend/sw.js`.
- **Shell helper:** `frontend/js/app-shell.js`.

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

1. From the repo root, generate one archive (overwrites the same file):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pack-hostinger.ps1
   ```

2. Upload **`hostinger-deploy.zip`**. Zip root must include **`package.json`**, **`server.js`**, **`backend/`**, **`frontend/`**, etc. (no `node_modules`; do not commit secrets — script skips `backend/.env`; include `backend/.env.production` on the server if you use it).

3. In hPanel (Node.js app): **Application startup file** `server.js`, install command `npm install`, start `npm start` (or as Hostinger presets Express).

4. **MCP / API:** if automated deploy fails, upload the same zip manually and set env vars in the panel.

5. **Windows path tip:** use forward slashes for tool paths, e.g. `c:/Users/.../hostinger-deploy.zip`.

## Notes

- Schema updates run on startup via `ensureSchema()` in the backend.
- Help and static routes are public where needed so the manual works from the login page.
- Footer line is configured in `frontend/js/app-shell.js`.
