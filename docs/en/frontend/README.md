# Frontend Reference (English Docs)

## Structure

The UI is implemented as static HTML pages with inline JavaScript and shared shell behavior in `frontend/js/app-shell.js`.

## Important Screens

- Dashboard (`index.html`)
- Manual entry (`add-record.html`)
- Receipt upload (`upload.html`)
- Projects (`projects.html`)
- Project details (`project-details.html`)
- Import (`import.html`)
- Settings (`settings.html`)
- Help (`help.html`)

## Recent UX Updates

- Location field: shared `js/locations.js` — native **select** + **New** (saved via `/api/locations`) on manual entry and receipt review.
- Project details moved from modal to standalone page.
- Project details include AI-generated insights and actionable recommendations.
- Recent ledger includes project column.
- Contextual help links available across screens.
- English copy standardized for user-facing texts and docs.
