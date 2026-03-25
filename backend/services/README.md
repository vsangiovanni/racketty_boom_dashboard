# Backend Services

Reusable backend helpers live in this folder.

## Current Service

- `excelImportService.js` -> parses Excel data, normalizes headers, converts dates/amounts, and prepares structured rows for import workflows.

## Usage Context

- Used by backend import logic and scripts that need spreadsheet parsing.
- Supports the preview/commit behavior exposed by import-related API routes.

## Guidelines

- Keep services side-effect free on module load.
- Pass dependencies (db pool, config) from caller when possible.
- Document each new service here with purpose and consumer path.
