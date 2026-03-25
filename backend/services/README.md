# Servicios backend

Módulos Node **requeridos** desde `server.js` u otros scripts para lógica reutilizable fuera del monolito principal.

## `excelImportService.js`

Servicio de **importación desde Excel**: lectura de hojas, mapeo de columnas y preparación de filas para insertar en la base (según el contrato que espere el endpoint de import o el script `import_excel.js`).

- **Quién lo usa:** busca referencias con `grep` o en `import_excel.js` / rutas `/api/import` en `server.js`.
- **Al cambiar el formato del Excel** de clientes, actualizar aquí la lógica de parseo y las pruebas manuales desde `import.html` o el script CLI.

## Añadir nuevos servicios

1. Crear `nuevoServicio.js` con `module.exports`.
2. `require` desde `server.js` (o script) en la parte superior del archivo.
3. Documentar en una línea en este README qué exporta y quién lo consume.

Mantener servicios **sin efectos secundarios al cargar** (no conectar a BD al `require`); inicializar dentro de funciones exportadas o recibir `pool` por parámetro.
