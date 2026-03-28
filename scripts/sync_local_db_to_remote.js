const mysql = require('../backend/node_modules/mysql2/promise');

const localConfig = {
  host: process.env.LOCAL_DB_HOST || 'localhost',
  port: Number(process.env.LOCAL_DB_PORT || 3306),
  user: process.env.LOCAL_DB_USER || 'root',
  password: process.env.LOCAL_DB_PASSWORD || '',
  database: process.env.LOCAL_DB_NAME || 'greg_tracker'
};

const remoteConfig = {
  host: process.env.REMOTE_DB_HOST,
  port: Number(process.env.REMOTE_DB_PORT || 3306),
  user: process.env.REMOTE_DB_USER,
  password: process.env.REMOTE_DB_PASSWORD,
  database: process.env.REMOTE_DB_NAME
};

function quoteId(id) {
  return `\`${String(id).replace(/`/g, '``')}\``;
}

async function getTables(conn) {
  const [rows] = await conn.query('SHOW TABLES');
  const key = Object.keys(rows[0] || {})[0];
  return rows.map((r) => r[key]).filter(Boolean);
}

async function copyTable(localConn, remoteConn, tableName) {
  const table = quoteId(tableName);
  const [createRows] = await localConn.query(`SHOW CREATE TABLE ${table}`);
  const createStmt = createRows[0] && createRows[0]['Create Table'];
  if (!createStmt) {
    throw new Error(`No se pudo leer CREATE TABLE de ${tableName}`);
  }

  await remoteConn.query(`DROP TABLE IF EXISTS ${table}`);
  await remoteConn.query(createStmt);

  const [cols] = await localConn.query(`SHOW COLUMNS FROM ${table}`);
  const fields = cols.map((c) => c.Field);
  const jsonFields = new Set(
    cols.filter((c) => String(c.Type || '').toLowerCase().includes('json')).map((c) => c.Field)
  );
  const [rows] = await localConn.query(`SELECT ${fields.map(quoteId).join(', ')} FROM ${table}`);

  if (!rows.length) {
    console.log(`- ${tableName}: 0 filas`);
    return 0;
  }

  const chunkSize = 300;
  const colsSql = fields.map(quoteId).join(', ');
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const rowTpl = `(${fields.map(() => '?').join(',')})`;
    const placeholders = chunk.map(() => rowTpl).join(',');
    const params = [];
    for (const row of chunk) {
      for (const field of fields) {
        let value = row[field];
        if (jsonFields.has(field)) {
          if (value === null || value === undefined || value === '') {
            value = null;
          } else {
            try {
              if (typeof value === 'string') {
                JSON.parse(value);
              } else {
                value = JSON.stringify(value);
              }
            } catch (_e) {
              value = null;
            }
          }
        }
        params.push(value);
      }
    }
    await remoteConn.query(
      `INSERT INTO ${table} (${colsSql}) VALUES ${placeholders}`,
      params
    );
  }

  console.log(`- ${tableName}: ${rows.length} filas`);
  return rows.length;
}

async function main() {
  if (!remoteConfig.host || !remoteConfig.user || !remoteConfig.password || !remoteConfig.database) {
    throw new Error('Faltan variables REMOTE_DB_HOST, REMOTE_DB_USER, REMOTE_DB_PASSWORD o REMOTE_DB_NAME');
  }

  const localConn = await mysql.createConnection(localConfig);
  const remoteConn = await mysql.createConnection(remoteConfig);

  try {
    const tables = await getTables(localConn);
    console.log(`Tablas encontradas: ${tables.length}`);

    await remoteConn.query('SET FOREIGN_KEY_CHECKS = 0');
    let totalRows = 0;
    for (const tableName of tables) {
      totalRows += await copyTable(localConn, remoteConn, tableName);
    }
    await remoteConn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`Sincronizacion completa. Filas copiadas: ${totalRows}`);
  } finally {
    await localConn.end();
    await remoteConn.end();
  }
}

main().catch((err) => {
  console.error('Error sincronizando DB:', err.message);
  process.exit(1);
});
