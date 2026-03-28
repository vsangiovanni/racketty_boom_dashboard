# Frontend (Static HTML + Vanilla JS)

The frontend is a multi-page static UI served by the Express backend.

## Main Screens

- `index.html` -> public marketing landing; imagery in `assets/landing/` (bundled) and lead-capture CTAs.
- `quote.html` -> public free estimate form (submits to the internal quote requests inbox).
- `dashboard.html` -> authenticated executive dashboard (KPIs, charts, recent ledger).
- `login.html` -> access screen.
- `add-record.html` -> manual transaction create/edit.
- `upload.html` -> receipt upload and AI-assisted extraction review.
- `import.html` -> Excel preview/validation/commit flow (optional **Assign import to project** before analyze/confirm).
- `export-report.html` -> accountant Excel download options (time period + optional project; calls `GET /api/export`).
- `projects.html` -> project list, project KPI summary, create/edit/delete.
- `project-details.html` -> dedicated project analytics page.
- `settings.html` -> company settings, branding, and access code.
- `help.html` -> context-aware user manual.

## Recent Functional Updates

- UI text and in-app documentation standardized in English.
- Project row click in `projects.html` opens `project-details.html?id=...`.
- Dashboard **Export** opens `export-report.html` with the current date filter as `?preset=...`; sidebar **Export Excel Report** links there too.
- `export-report.html` supports optional `?project_id=` to pre-select a project.
- Dashboard now includes a "Quote Requests" lead inbox for managers/admins.
- Dashboard ledger now shows each transaction's project.
- Add/edit and upload flows include `project_id` support.
- Bulk import assigns an optional `project_id` on commit (`POST /api/import/commit`).
- Project details now include an AI-powered "Insights & Recommendations" card (with local fallback when AI is unavailable).
- Shared header/footer behavior unified through `js/app-shell.js`.

## Shared Frontend Utility

- `js/app-shell.js`:
  - injects footer into elements marked with `data-shell-footer`
  - hydrates `.shell-business-name` from `/api/settings/public`

## Help Navigation

Use `help.html?page=<section>`:

- `login`
- `dashboard`
- `manual-entry`
- `upload`
- `projects`
- `import`
- `export-excel` (Export Excel report screen)
- `settings`

`help copy.html` is a legacy redirect page to the main help screen.
