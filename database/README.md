# Database Notes

This folder stores SQL references and migration helpers for Greg Tracker.

## Current Reality

- Runtime schema changes are applied by backend startup (`ensureSchema()` in `backend/server.js`).
- SQL files in this folder are useful references but may not fully match runtime state.

## Files

- `schema.sql` -> historical/base schema reference.
- `migration_phase1.sql` -> phased migration notes and additional structures.

## Recent Data Model Highlights

- Transactions support optional `project_id`.
- Settings include nullable access code field (`app_pin`) and branding fields.
- Receipt extraction and review flow writes to dedicated upload/draft tables.
- Import flow uses staging/metadata tables for batch operations.

## Recommended Workflow

1. Validate schema behavior against `backend/server.js` first.
2. Keep SQL docs updated when backend schema logic changes.
3. Use `utf8mb4` for compatibility and consistency.
