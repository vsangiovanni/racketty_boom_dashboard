# Greg Tracker (Racketty Boom Dashboard)

Aplicación web para **seguimiento financiero** de una empresa: ingresos y gastos, con opción de **asignar movimientos a proyectos**, **importar Excel**, **exportar informes**, **entrada manual** y **extracción asistida por IA** desde fotos de recibos o facturas.

## Concepto

El sistema centraliza registros contables en **MySQL**. El front es una **PWA** servida por el mismo backend (Express sirve los HTML estáticos). El acceso está protegido por un **PIN** configurado en Ajustes.

**Usuarios típicos:** dueño de negocio o contabilidad ligera que quiere ver KPIs, tendencias y detalle por proveedor/categoría/proyecto sin depender solo de hojas sueltas.

## Flujo principal (alto nivel)

1. **Acceso** (`login.html`) — el usuario introduce el PIN; se guarda cookie `auth_pin`.
2. **Panel** (`index.html`) — elige rango de fechas, ve resúmenes, gráficos y tabla paginada de transacciones; puede exportar Excel o abrir un registro para editar.
3. **Alta de datos** (cualquiera de estos caminos):
   - **Entrada manual** (`add-record.html`) — formulario completo (tipo, importes, impuestos, categoría, proyecto).
   - **Escaneo IA** (`upload.html`) — sube imagen; el servidor llama a OpenAI o Gemini y devuelve un borrador; el usuario confirma y se crea la transacción vinculada al recibo.
   - **Importar Excel** (`import.html`) — analiza filas, previsualiza y confirma carga masiva.
4. **Proyectos** (`projects.html`) — define obras/trabajos y ve agregados de ingresos/gastos por proyecto (solo movimientos con `project_id`).
5. **Ajustes** (`settings.html`) — nombre de empresa, PIN, logo y avatar.

**Manual de usuario en la app:** `help.html?page=...` (también enlaces “Ayuda” en cada pantalla).

## Arquitectura resumida

```
[ Navegador ]
     |
     v
[ Express (server.js) ] ---- MySQL (pool mysql2)
     |   \
     |    \-- archivos subidos (UPLOAD_DIR)
     |
[ frontend/*.html + js/ ]  (estáticos)
```

- **Un solo proceso Node** monta API JSON bajo `/api/*` y archivos bajo `/`.
- El esquema de BD se **crea y migra en parte al arrancar** (`ensureSchema` dentro de `server.js`), además de scripts SQL en `database/`.

## Estructura del repositorio

| Carpeta | Documentación |
|--------|----------------|
| `backend/` | [README](backend/README.md) — API, scripts Node, servicios |
| `frontend/` | [README](frontend/README.md) — páginas, shell compartido, ayuda |
| `database/` | [README](database/README.md) — SQL de referencia y migraciones |

## Puesta en marcha rápida

1. **MySQL:** crear base (p. ej. `greg_tracker`) con UTF-8.
2. **Backend:**
   ```bash
   cd backend
   cp .env.example .env
   # Editar .env con DB_* y, si usas IA, OPENAI_* o GEMINI_*
   npm install
   npm start
   ```
3. Abrir `http://localhost:4000` (o el `PORT` configurado). La primera vez el servidor aplica migraciones lógicas en BD.

El codigo de acceso se define en `settings.html` (en la tabla `settings`). Si no esta configurado, la pantalla de acceso no permitira entrar.

## Convenciones útiles al volver al proyecto

- La lógica de negocio “gorda” está en **`backend/server.js`** (monolito); conviene buscar por prefijo de ruta (`/api/transactions`, `/api/receipts`, etc.).
- Los HTML **no usan bundler**: cada página es autónoma con Tailwind por CDN salvo `js/app-shell.js` compartido.
- Rutas **publicas sin acceso** (middleware): `login.html`, `help.html`, `/js/*`, `/api/settings/public`, `/api/auth`, subidas publicas segun configuracion actual.

## Licencia / autor

Proyecto privado de uso interno; pie de página en la app: mensaje personal en `frontend/js/app-shell.js`.
