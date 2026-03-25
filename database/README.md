# Base de datos (SQL de referencia y migraciones)

Esta carpeta contiene **scripts SQL** para documentar o aplicar cambios de esquema. El servidor en producción/desarrollo **también modifica el esquema en runtime** mediante `ensureSchema()` en `../backend/server.js`, por lo que hay que entender **las dos fuentes**.

## Archivos

| Archivo | Propósito |
|---------|-----------|
| **`schema.sql`** | Esquema “ideal” / documental antiguo (tablas `transactions` con `txn_type`, `receipts`, etc.). **No coincide al 100%** con el modelo que crea `server.js` actualmente (tipos `Income`/`Expense`, tablas `receipt_uploads`, etc.). Úsalo como referencia histórica o para entender la intención del producto, no como única verdad para un `mysql < schema.sql` en limpio. |
| **`migration_phase1.sql`** | Migración por fases: `import_batches`, `review_flags`, `settings`, columnas extra en `transactions`. Parte de esto está **replicada o adaptada** dentro de `ensureSchema` en el backend. |

## Flujo recomendado al retomar el proyecto

1. **Arrancar el backend** con MySQL vacío o existente: `ensureSchema` crea/altera tablas según el código actual.
2. Si necesitas **reproducir un entorno solo con SQL**, prioriza leer **`server.js`** (función `ensureSchema` y bloques `ALTER`) y luego estos archivos como apoyo.
3. Para cambios nuevos: o bien añades SQL versionado aquí **y** reflejas lo mismo en `ensureSchema`, o centralizas solo en el servidor y documentas el cambio en un comentario o en este README.

## Convenciones

- Charset recomendado: **utf8mb4**.
- Nombre de base típico: `greg_tracker` (configurable en `.env`).
