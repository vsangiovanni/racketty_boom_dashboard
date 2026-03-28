# Greg Tracker

Greg Tracker is a web app for small-business bookkeeping and project-level financial tracking.  
It combines manual data entry, AI-assisted receipt extraction, and Excel import/export in one flow.

## What Is New

- Full UI and user manual in English.
- Dedicated project details screen at `frontend/project-details.html` (no modal).
- Client lead-capture: `frontend/quote.html` replaces outbound “Free quote” links and submits requests to the internal app.
- Dashboard lead inbox: managers/admin can see and update submitted quote requests.
- **Export Excel report** (`frontend/export-report.html`): choose time period and optional project before downloading the accountant workbook (`GET /api/export` with `filter`, `value`, optional `project_id`).
- **Bulk Excel import** (`frontend/import.html`): assign all imported rows to a project (or leave unassigned); `POST /api/import/commit` accepts optional `project_id`.
- Project analytics endpoints:
  - `GET /api/projects/:id/stats`
  - `GET /api/projects/:id/transactions`
  - `GET /api/projects/:id/breakdown`
- AI project insights endpoint:
  - `GET /api/projects/:id/ai-insights`
- Dashboard "Recent Ledger" now includes a **Project** column.
- Access-code flow no longer relies on a hardcoded default value.

## Main User Flow

1. Open `/` for the Racketty Boom landing, then sign in from `login.html` with your team or company access code.
2. Use `dashboard.html` to review KPIs, charts, recent ledger records, and quote request submissions.
3. Add records using:
   - `add-record.html` (manual entry/edit)
   - `upload.html` (AI receipt extraction + review)
   - `import.html` (Excel preview + commit; pick target project before importing)
4. Export the accountant Excel file from `export-report.html` (period + optional project), or jump there from the dashboard **Export** action.
5. Manage projects in `projects.html` and open project analytics in `project-details.html` (including AI insights and recommendations).
6. Update company profile and access code in `settings.html`.
7. Open context-aware help from any screen via `help.html?page=...` (includes **export-excel** for the export screen).

## Architecture

- **Backend:** Node.js + Express (`backend/server.js`)
- **Database:** MySQL (`mysql2/promise`)
- **Frontend:** Static HTML + Tailwind CDN + vanilla JS
- **PWA assets:** `frontend/manifest.webmanifest`, `frontend/sw.js`
- **Shared shell UI helper:** `frontend/js/app-shell.js`

## Repository Guide

- `backend/` -> API, auth, schema bootstrap, imports, receipt flows
- `frontend/` -> all screens, UI behavior, in-app help
- `database/` -> SQL references/migration notes
- `docs/en/` -> additional English technical context

## Quick Start

1. Configure MySQL and create a database (for example `greg_tracker`).
2. In `backend/`, copy `.env.example` to `.env` and fill `DB_*` values.
3. Install dependencies and run server:
   - `npm install`
   - `npm start`
4. Open `http://localhost:4000`.

## Notes

- The backend performs schema checks/migrations on startup via `ensureSchema()`.
- Help and shared JS routes are public so documentation works from the login page.
- Footer text is managed in `frontend/js/app-shell.js`.
