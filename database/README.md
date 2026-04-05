# Database Notes

## Fuente de verdad del esquema

El modelo fisico MySQL que usa la aplicacion se define y actualiza en **`ensureSchema()`** dentro de **`backend/server.js`**. Ese bloque:

- Crea tablas en **orden de dependencias** (FK correctas en instalaciones nuevas).
- Define **`transactions`** con **todas** las columnas del ledger (importes, impuestos, `vendor_id`, `import_batch_id`, `location`, etc.).
- Incluye **`quote_requests.team_first_viewed_at`** en el `CREATE` actual.
- Mantiene una **fase interna** de `ALTER` tolerantes a columnas/FK ya existentes para bases creadas con versiones anteriores.

Los `.sql` de esta carpeta son **documentacion / historial**, no el pipeline de migracion en runtime.

## Archivos

| Archivo | Uso |
|--------|-----|
| `schema.sql` | Aviso: esquema historico; no refleja el modelo actual. |
| `migration_phase1.sql` | Notas legacy; el codigo vivo esta en `server.js`. |

## Buenas practicas

1. Cualquier nueva tabla o columna: implementarla primero en **`ensureSchema()`** y probar arranque contra MySQL vacio y contra una copia de produccion.
2. Actualizar este README o comentarios en `migration_phase1.sql` si el modelo cambia de forma notable.
3. Charset recomendado: **utf8mb4** (ya usado en los `CREATE` del servidor).
