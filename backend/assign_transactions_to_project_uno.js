/**
 * Asigna project_id a todas las transacciones que lo tienen NULL.
 * Busca un proyecto cuyo nombre sea "Uno" (sin importar mayusculas).
 * Si no existe, usa el proyecto con id minimo.
 */
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 1
  });
  try {
    const [byName] = await pool.query(
      "SELECT id FROM projects WHERE LOWER(TRIM(name)) = 'uno' LIMIT 1"
    );
    let projectId = byName[0]?.id;
    if (!projectId) {
      const [first] = await pool.query('SELECT id FROM projects ORDER BY id ASC LIMIT 1');
      projectId = first[0]?.id;
    }
    if (!projectId) {
      console.error('No hay proyectos en la base de datos. Crea uno (por ejemplo "Uno") y vuelve a ejecutar.');
      process.exit(1);
    }
    const [r] = await pool.query(
      'UPDATE transactions SET project_id = ? WHERE project_id IS NULL',
      [projectId]
    );
    console.log('OK. project_id =', projectId, '| filas actualizadas:', r.affectedRows);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
