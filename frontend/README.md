# Frontend (HTML estático + PWA ligera)

Interfaz del Greg Tracker: **páginas HTML** servidas por Express desde `../backend/server.js`. No hay React/Vue; cada pantalla incluye **Tailwind CSS vía CDN** y scripts inline o un JS compartido mínimo.

## Páginas principales

| Archivo | Función |
|---------|---------|
| `login.html` | Acceso con PIN; carga nombre/logo públicos. |
| `index.html` | Dashboard: filtros de fecha, KPIs, gráficos (Chart.js), tabla de transacciones, export. |
| `add-record.html` | Alta/edición manual (`?id=` para editar). Categorías, proyectos, modal nuevo proyecto. |
| `upload.html` | Flujo recibo: subida imagen → borrador IA → formulario de revisión → `review-confirm`. |
| `projects.html` | Listado de proyectos, KPIs por proyecto, gráfico, CRUD proyectos. |
| `import.html` | Asistente Excel en pasos (subir → analizar → previsualizar → confirmar). |
| `settings.html` | Empresa, PIN, logo y avatar (multipart). |
| `help.html` | Manual de usuario; parámetro `?page=` para contexto (login, dashboard, manual-entry, upload, projects, import, settings). |

## JavaScript compartido

| Archivo | Función |
|---------|---------|
| **`js/app-shell.js`** | Tras `DOMContentLoaded`: inserta pie de página en elementos `[data-shell-footer]` y rellena `.shell-business-name` desde `/api/settings/public`. Variante oscura: `data-shell-footer-dark`. |

El resto de la lógica vive **en `<script>` dentro de cada HTML**.

## Enlaces “Ayuda”

Cada cabecera relevante incluye un icono que apunta a `/help.html?page=...` para abrir el manual en la sección correcta. El backend permite `help.html` y `/js/` **sin PIN** para que funcione también en login.

## Otros archivos

| Archivo | Notas |
|---------|--------|
| `manifest.webmanifest` | Metadatos PWA. |
| `sw.js` | Service worker (si está registrado en alguna página; revisar al cambiar caché). |
| `icon.svg` | Icono de la app. |

## Estilo y UX

- Tipografía del sistema o Google Fonts según página.
- **Material Icons** (CDN) para iconografía.
- Layout **mobile-first**; dashboard y projects usan sidebar colapsable en móvil.

## Al modificar el front

1. Si añades una página nueva, regístrala en el **middleware público** del servidor si debe verse sin login, o protégela por defecto.
2. Para el mismo pie y nombre de empresa, reutiliza clases **`shell-business-name`**, **`data-shell-footer`** y script **`/js/app-shell.js`**.
3. Evita colocar **`<script>` que use el DOM** antes de que existan los nodos (ej. modales debajo del script): el orden importa.
