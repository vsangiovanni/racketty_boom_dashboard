# Greg Tracker (Racketty Boom Dashboard)

Web application for **financial tracking** of a company: income and expenses, with the option to **assign movements to projects**, **import Excel**, **export reports**, **manual entry**, and **AI-assisted extraction** from receipt or invoice photos.

## Concept

The system centralizes accounting records in **MySQL**. The frontend is a **PWA** served by the same backend (Express serves static HTML). Access is protected by a **PIN** configured in Settings.

**Typical users:** business owner or light accounting who wants to see KPIs, trends, and details by vendor/category/project without relying solely on loose spreadsheets.

## Main flow (high level)

1. **Access** (`login.html`) — user enters PIN; `auth_pin` cookie is saved.
2. **Dashboard** (`index.html`) — choose date range, view summaries, charts, and paginated transaction table; can export Excel or open a record to edit.
3. **Data entry** (any of these paths):
   - **Manual entry** (`add-record.html`) — complete form (type, amounts, taxes, category, project).
   - **AI Scanning** (`upload.html`) — upload image; server calls OpenAI or Gemini and returns a draft; user confirms and transaction is created linked to the receipt.
   - **Import Excel** (`import.html`) — analyzes rows, previews, and confirms bulk load.
4. **Projects** (`projects.html`) — define jobs/work and see income/expense aggregations by project (only movements with `project_id`).
5. **Settings** (`settings.html`) — company name, PIN, logo, and avatar.

**User manual in the app:** `help.html?page=...` (also "Help" links on each screen).

## Summarized architecture

```
[ Browser ]
     |
     v
[ Express (server.js) ] ---- MySQL (pool mysql2)
     |   \
     |    \-- uploaded files (UPLOAD_DIR)
     |
[ frontend/*.html + js/ ]  (static)
```

- **Single Node process** mounts JSON API under `/api/*` and files under `/`.
- DB schema is **created and migrated partially on startup** (`ensureSchema` inside `server.js`), plus SQL scripts in `database/`.

## Repository structure

| Folder | Documentation |
|--------|----------------|
| `backend/` | [README](backend/README.md) — API, Node scripts, services |
| `frontend/` | [README](frontend/README.md) — pages, shared shell, help |
| `database/` | [README](database/README.md) — reference SQL and migrations |

## Quick start

1. **MySQL:** create database (e.g., `greg_tracker`) with UTF-8.
2. **Backend:**
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with DB_* and, if using AI, OPENAI_* or GEMINI_*
   npm install
   npm start
   ```
3. Open `http://localhost:4000` (or configured `PORT`). First time server applies logical migrations to DB.

The access code is defined in `settings.html` (stored in the `settings` table). If it is not configured, the access screen will block entry.

## Useful conventions when returning to the project

- The "heavy" business logic is in **`backend/server.js`** (monolith); search by route prefix (`/api/transactions`, `/api/receipts`, etc.).
- HTML **does not use bundler**: each page is autonomous with Tailwind via CDN except `js/app-shell.js` shared.
- **Public routes without access** (middleware): `login.html`, `help.html`, `/js/*`, `/api/settings/public`, `/api/auth`, public uploads per current config.

## License / author

Internal private project; footer in app: personal message in `frontend/js/app-shell.js`.
