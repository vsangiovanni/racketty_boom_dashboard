# Frontend (Static HTML + Vanilla JS)

The frontend is a multi-page static UI served by the Express backend.

## Main Screens

- `login.html` -> access screen.
- `index.html` -> dashboard with KPIs, charts, and recent ledger.
- `add-record.html` -> manual transaction create/edit.
- `upload.html` -> receipt upload and AI-assisted extraction review.
- `import.html` -> Excel preview/validation/commit flow.
- `projects.html` -> project list, project KPI summary, create/edit/delete.
- `project-details.html` -> dedicated project analytics page.
- `settings.html` -> company settings, branding, and access code.
- `help.html` -> context-aware user manual.

## Recent Functional Updates

- UI text and in-app documentation standardized in English.
- Project row click in `projects.html` opens `project-details.html?id=...`.
- Dashboard ledger now shows each transaction's project.
- Add/edit and upload flows include `project_id` support.
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
- `settings`

`help copy.html` is a legacy redirect page to the main help screen.
