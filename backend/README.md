# Backend (Node / Express)

Servidor principal del Greg Tracker: **API REST**, **autenticación por PIN con cookie**, **servicio de archivos estáticos del frontend** y **inicialización de esquema MySQL** al arrancar.

## Archivo central

| Archivo | Rol |
|---------|-----|
| **`server.js`** | Aplicación Express: CORS, JSON, `multer` para subidas, rutas `/api/*`, `ensureSchema()` (DDL + ALTER incrementales), arranque del pool MySQL y `listen`. |

Es el punto único de verdad para la mayoría de endpoints. Si añades una ruta nueva, casi siempre va aquí.

## Autenticación

- `POST /api/auth` — valida PIN contra `settings.app_pin` (cargado en memoria desde BD).
- Cookie `httpOnly` `auth_pin`.
- Middleware global: rutas públicas listadas en código (`login.html`, `help.html`, prefijo `/js/`, ` /api/settings/public`, etc.); el resto exige cookie válida o redirige a login / 401 en API.

## API (grupos funcionales)

Sin listar cada ruta: busca en `server.js` por texto `app.get`, `app.post`, etc.

- **Transacciones:** listado paginado, CRUD, `review-confirm` (confirmar borrador tras subir recibo), export Excel.
- **Recibos / IA:** subida de imagen, borrador en tablas de extracción, integración OpenAI/Gemini según `VISION_PROVIDER` y claves en `.env`.
- **Categorías, proyectos, settings** (incl. subida logo/avatar).
- **Importación:** endpoint de commit tras el flujo del `import.html`.
- **Stats / agregados** para el dashboard.
- **`/health`** — comprobación de BD.

Variables relevantes: ver **`.env.example`** en esta carpeta (copiar a `.env`).

## Scripts auxiliares (`node …`)

| Script | Uso |
|--------|-----|
| `npm start` / `npm run dev` | Arranca `server.js`. |
| `npm run import:excel` | `import_excel.js` — importación desde Excel por línea de comandos (ruta configurable). |
| `npm run assign:project-uno` | `assign_transactions_to_project_uno.js` — asigna `project_id` a transacciones sin proyecto (proyecto “Uno” o id mínimo). |
| `run_migration.js` | Ejecutar migraciones SQL según cómo esté implementado. |
| `import_excel.js` | Lógica batch Excel (usa `xlsx` / flujo propio). |
| `cleanup.js`, `fix_columns.js`, `seed_categories.js` | Mantenimiento / datos iniciales puntuales. |
| `auto_start.js` | Arranque automático en entornos donde se use. |

## Carpeta `services/`

Ver **[services/README.md](services/README.md)** — importación Excel reutilizable desde código.

## Archivos a tener en cuenta

- **`project-stats-api.js`** — fragmentos de rutas `app.get` **no integrados** en `server.js`. Si se quieren usar, hay que requerirlos o copiar rutas dentro de `server.js`; si no, son solo referencia o trabajo a medias.

## Dependencias clave (`package.json`)

- `express`, `cors`, `dotenv`, `mysql2`, `multer`, `xlsx`, `exceljs` (export).

## Buenas prácticas al retomar el proyecto

1. Tras cambios de BD, revisar si hace falta ampliar **`ensureSchema`** o un script en `database/`.
2. No commitear **`.env`** (está en `.gitignore`).
3. Subidas: directorio `UPLOAD_DIR` (relativo al cwd del proceso, normalmente `backend/`).
