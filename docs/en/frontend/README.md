# Frontend (Static HTML + Light PWA)

Greg Tracker interface: **HTML pages** served by Express from `../backend/server.js`. No React/Vue; each screen includes **Tailwind CSS via CDN** and inline scripts or minimal shared JS.

## Main pages

| File | Function |
|------|----------|
| `login.html` | Access with PIN; loads public company name/logo. |
| `index.html` | Dashboard: date filters, KPIs, charts (Chart.js), transaction table, export. |
| `add-record.html` | Manual add/edit (income or expense). |
| `upload.html` | Receipt flow: image upload → AI draft → review form → `review-confirm`. |
| `projects.html` | Project list, KPIs by project, chart, project CRUD. |
| `import.html` | Excel wizard (upload → analyze → preview → confirm). |
| `settings.html` | Company, PIN, logo and avatar (multipart). |
| `help.html` | User manual; `?page=` parameter for context (login, dashboard, manual-entry, upload, projects, import, settings). |

## Shared JavaScript

| File | Function |
|------|----------|
| **`js/app-shell.js`** | After `DOMContentLoaded`: inserts footer into elements `[data-shell-footer]` and fills `.shell-business-name` from `/api/settings/public`. Dark variant: `data-shell-footer-dark`. |

The rest of logic lives **inside `<script>` in each HTML**.

## "Help" links

Every relevant header includes an icon linking to `/help.html?page=...` to open the manual in the correct section. Backend allows `help.html` and `/js/` **without PIN** so login page help also works.

## Other files

| File | Notes |
|------|-------|
| `manifest.webmanifest` | PWA metadata. |
| `sw.js` | Service worker (if registered on any page; check when changing cache). |
| `icon.svg` | App icon. |

## Style and UX

- System font or Google Fonts per page.
- **Material Icons** (CDN) for icons.
- **Mobile-first** layout; dashboard and projects use collapsible sidebar on mobile.

## When modifying the frontend

1. If you add a new page, register it in the server's **public middleware** if it must be visible without login, or protect it by default.
2. For shared footer and company name, reuse classes **`shell-business-name`**, **`data-shell-footer`**, and script **`/js/app-shell.js`**.
3. Avoid placing **`<script>` that uses the DOM** before nodes exist (e.g., modals below the script): order matters.
