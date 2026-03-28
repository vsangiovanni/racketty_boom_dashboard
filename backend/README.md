# Backend (Node.js / Express)

This module contains the main API and runtime schema management for Greg Tracker.

## Core Responsibilities

- Authentication: company PIN and/or per-user access (hashed) with roles Admin / Manager / Viewer (`app_users` table).
- REST APIs for transactions, projects, categories, settings, and imports.
- Receipt upload + AI extraction draft + review-confirm flow.
- Client lead capture: quote request intake and manager/admin lead inbox.
- MySQL schema bootstrap/update through `ensureSchema()` during startup.
- Static serving support for frontend screens and uploads (`/` and `index.html` are public landing; app dashboard is `dashboard.html`).

## Key File

- `server.js` -> primary application entry point and route definitions.

## Project Analytics Endpoints

- `GET /api/projects/:id/stats` -> income, expenses, net profit, margin, tx count.
- `GET /api/projects/:id/transactions?limit=10` -> recent project transactions.
- `GET /api/projects/:id/breakdown?limit=6` -> top categories and vendors.
- `GET /api/projects/:id/ai-insights` -> AI-generated summary, insights, and recommendations.
- `GET /api/projects/:id/ledger-signals` -> financial activity derived from ledger (counts, date span, weekly pace, income/expense ratio, optional budget consumption).

These endpoints power `frontend/project-details.html`.

## Other Important API Areas

- `/api/transactions` -> list, create, update, delete, pagination.
- `/api/transactions/review-confirm` -> creates transaction from reviewed AI draft.
- `/api/import/preview` and `/api/import/commit` -> Excel import flow. **Commit** accepts optional `project_id` in the JSON body; all inserted transactions get that `project_id` (or `NULL` if omitted). Duplicate detection includes `project_id` so the same line can exist on different projects.
- `GET /api/export` -> accountant Excel download. Query: `filter` (`year` | `month` | `all`), `value` (year number or `YYYY-M` for month), optional `project_id` to restrict rows to one project. Filename adds `_project{id}` when a project filter is used.
- `/api/quote-requests`:
  - `POST /api/quote-requests` -> submit a free estimate request (public).
  - `GET /api/quote-requests` -> list requests for managers/admins.
  - `PATCH /api/quote-requests/:id` -> update lead status/notes (managers/admins).
- `/api/settings` (GET/POST, **Admin only**) and `/api/settings/public` -> full settings vs public branding metadata.
- `/api/auth` -> sign in (`pin` for company mode, or `user_id` + `pin` when team users exist); sets `auth_pin` or `gt_uid`/`gt_pin` cookies.
- `/api/auth/options` -> public; whether multi-user login is required and the list of active users for the login screen.
- `/api/session/me` -> current session (legacy vs named user + role).
- `/api/users` -> Admin-only CRUD for team users (GET list, POST create, PATCH update PIN/role/active, DELETE).
- `/health` -> DB health check endpoint.

## Scripts

- `npm start` / `npm run dev` -> run backend server.
- `npm run import:excel` -> CLI-based Excel import.
- `npm run assign:project-uno` -> assign missing `project_id` values.

## Notes for Future Work

- `project-stats-api.js` contains route fragments not wired as a module.
- Keep schema changes aligned between `ensureSchema()` and SQL references in `database/`.
- Avoid committing secrets from `.env`.
