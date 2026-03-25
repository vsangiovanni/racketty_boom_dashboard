# Backend (Node / Express)

Main server for Greg Tracker: **REST API**, **PIN authentication with cookie**, **frontend static file serving**, and **MySQL schema initialization** on startup.

## Central file

| File | Role |
|------|------|
| **`server.js`** | Express application: CORS, JSON, `multer` for uploads, `/api/*` routes, `ensureSchema()` (DDL + incremental ALTER), MySQL pool startup and `listen`. |

It's the single source of truth for most endpoints. If you add a new route, it almost always goes here.

## Authentication

- `POST /api/auth` — validates PIN against `settings.app_pin` (loaded in memory from DB).
- Cookie `httpOnly` `auth_pin`.
- Global middleware: public routes listed in code (`login.html`, `help.html`, `/js/` prefix, `/api/settings/public`, etc.); rest require valid cookie or redirect to login / 401 in API.

## API (functional groups)

Not listing each route: search in `server.js` for `app.get`, `app.post`, etc.

- **Transactions:** paginated listing, CRUD, `review-confirm` (confirm draft after receipt upload), Excel export.
- **Receipts / AI:** image upload, draft in extraction tables, OpenAI/Gemini integration based on `VISION_PROVIDER` and keys in `.env`.
- **Categories, projects, settings** (incl. logo/avatar upload).
- **Import:** commit endpoint after `import.html` flow.
- **Stats / aggregates** for dashboard.
- **`/health`** — DB check.

Relevant variables: see **`.env.example`** in this folder (copy to `.env`).

## Auxiliary scripts (`node …`)

| Script | Use |
|--------|-----|
| `npm start` / `npm run dev` | Starts `server.js`. |
| `npm run import:excel` | `import_excel.js` — command-line Excel import (configurable path). |
| `npm run assign:project-uno` | `assign_transactions_to_project_uno.js` — assigns `project_id` to transactions without project (project "Uno" or min id). |
| `run_migration.js` | Execute SQL migrations as implemented. |
| `import_excel.js` | Batch Excel logic (uses `xlsx` / custom flow). |
| `cleanup.js`, `fix_columns.js`, `seed_categories.js` | Maintenance / one-time initial data. |
| `auto_start.js` | Auto-start in environments where used. |

## `services/` folder

See **[services/README.md](services/README.md)** — reusable Excel import from code.

## Files to note

- **`project-stats-api.js`** — `app.get` route fragments **not integrated** into `server.js`. If you want to use them, you must require them or copy routes into `server.js`; otherwise they're just reference or partial work.

## Key dependencies (`package.json`)

- `express`, `cors`, `dotenv`, `mysql2`, `multer`, `xlsx`, `exceljs` (export).

## Best practices when resuming the project

1. After DB changes, review if **`ensureSchema`** needs extension or a script in `database/`.
2. Do not commit **`.env`** (in `.gitignore`).
3. Uploads: `UPLOAD_DIR` directory (relative to process cwd, usually `backend/`).
