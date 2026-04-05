# Backend Reference (English Docs)

## Responsibilities

- Auth middleware and access-cookie verification.
- CRUD and analytics APIs.
- Receipt extraction and review-confirm workflow.
- Runtime DB schema updates on startup.

## Newly Documented Behavior

- Quote requests: `GET /api/quote-requests/unread-count` and `team_first_viewed_at` on `quote_requests` (set on first `GET /api/quote-requests/:id`).
- Production env: `DATABASE_URL` / `MYSQL_*` fallbacks and layered `.env` loading (see root `README.md`).
- Project analytics endpoints support the dedicated project details page.
- Project AI insights endpoint (`/api/projects/:id/ai-insights`) returns summary, insights, and recommendations.
- Transaction APIs include `project_id` read/write behavior.
- Public help and shared JS routes are allowed for pre-login documentation.
- Locations master list: `GET`/`POST` `/api/locations`; `locations` table + merge with distinct `transactions.location`.

## Operational Notes

- Main logic is centralized in `backend/server.js`.
- Keep `ensureSchema()` and SQL documentation synchronized.
- Verify `.env` completeness before running deployment builds.
