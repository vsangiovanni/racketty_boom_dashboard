# Backend (Node.js / Express)

This module contains the main API and runtime schema management for Greg Tracker.

## Core Responsibilities

- Authentication with cookie-based access code validation.
- REST APIs for transactions, projects, categories, settings, and imports.
- Receipt upload + AI extraction draft + review-confirm flow.
- MySQL schema bootstrap/update through `ensureSchema()` during startup.
- Static serving support for frontend screens and uploads.

## Key File

- `server.js` -> primary application entry point and route definitions.

## Project Analytics Endpoints

- `GET /api/projects/:id/stats` -> income, expenses, net profit, margin, tx count.
- `GET /api/projects/:id/transactions?limit=10` -> recent project transactions.
- `GET /api/projects/:id/breakdown?limit=6` -> top categories and vendors.
- `GET /api/projects/:id/ai-insights` -> AI-generated summary, insights, and recommendations.

These endpoints power `frontend/project-details.html`.

## Other Important API Areas

- `/api/transactions` -> list, create, update, delete, pagination.
- `/api/transactions/review-confirm` -> creates transaction from reviewed AI draft.
- `/api/import/preview` and `/api/import/commit` -> Excel import flow.
- `/api/settings` and `/api/settings/public` -> branding + access code metadata.
- `/api/auth` -> sign in and access cookie issuance.
- `/health` -> DB health check endpoint.

## Scripts

- `npm start` / `npm run dev` -> run backend server.
- `npm run import:excel` -> CLI-based Excel import.
- `npm run assign:project-uno` -> assign missing `project_id` values.

## Notes for Future Work

- `project-stats-api.js` contains route fragments not wired as a module.
- Keep schema changes aligned between `ensureSchema()` and SQL references in `database/`.
- Avoid committing secrets from `.env`.
