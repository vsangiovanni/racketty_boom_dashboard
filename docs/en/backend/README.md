# Backend Reference (English Docs)

## Responsibilities

- Auth middleware and access-cookie verification.
- CRUD and analytics APIs.
- Receipt extraction and review-confirm workflow.
- Runtime DB schema updates on startup.

## Newly Documented Behavior

- Project analytics endpoints support the dedicated project details page.
- Project AI insights endpoint (`/api/projects/:id/ai-insights`) returns summary, insights, and recommendations.
- Transaction APIs include `project_id` read/write behavior.
- Public help and shared JS routes are allowed for pre-login documentation.

## Operational Notes

- Main logic is centralized in `backend/server.js`.
- Keep `ensureSchema()` and SQL documentation synchronized.
- Verify `.env` completeness before running deployment builds.
