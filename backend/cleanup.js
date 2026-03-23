const mysql = require('mysql2/promise');
require('dotenv').config();

async function clean() {
  console.log('Conectando para borrar registros...');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'greg_tracker'
  });

  try {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('TRUNCATE TABLE review_flags');
    await pool.query('TRUNCATE TABLE transactions');
    await pool.query('TRUNCATE TABLE import_batches');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✅ Todos los registros han sido borrados. La base de datos esta limpia.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error limpiando base de datos:', err.message);
    process.exit(1);
  }
}

clean();