# Frontend (Static HTML + Vanilla JS)

The frontend is a multi-page UI served by the Express backend from `frontend/`.

## Main screens

- `index.html` — public landing; assets in `assets/landing/`.
- `quote.html` — public estimate form (`POST /api/quote-requests`).
- `quote-requests.html` — **managers/admins**: lead inbox (filters, detail panel, internal notes, `PATCH /api/quote-requests/:id`).
- `dashboard.html` — KPIs, charts, recent ledger (with project column).
- `login.html` — access.
- `add-record.html` — manual create/edit transaction.
- `upload.html` — receipt upload + AI extraction review.
- `import.html` — Excel preview/commit; optional project assignment.
- `export-report.html` — accountant Excel download (`GET /api/export`).
- `projects.html` — project list with **Active / Completed / All** tabs, KPIs scoped to tab, quick complete/reopen.
- `project-details.html` — project analytics, budget, insights; status bar to complete/reopen.
- `settings.html` — company settings and branding (admins).
- `help.html` — context-aware manual (`?page=...`, includes `quote-requests`).

## Recent behavior

- **Location** (`js/locations.js`): on **Manual Entry** and **Receipt Scan**, location is a **`<select>`** (same UX as category/project on mobile), with **New** opening a modal to `POST /api/locations` and refresh the list. Editing a record with a location not in the list adds a temporary “(saved)” option.
- Quote pipeline: dedicated **Quote requests** page (not a dashboard card).
- Project dropdowns (manual entry, upload, import, export) use **optgroups**: Active vs Completed; completed options show `(completed)` and remain selectable for corrections.
- Dashboard **Export** opens `export-report.html` with `?preset=...`.
- Project row opens `project-details.html?id=...`.
- Shared chrome: `js/app-shell.js`.

## Help pages

`help.html?page=<section>`:

- `login`, `dashboard`, `manual-entry`, `upload`, `projects`, `quote-requests`, `import`, `export-excel`, `settings`
