const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
  console.log('Connecting to database using .env credentials...');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'greg_tracker'
  });

  try {
    const sqlPath = path.join(__dirname, '../database/migration_phase1.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    
    // Separar los comandos por punto y coma
    const queries = sqlContent.split(';').map(q => q.trim()).filter(q => q.length > 0);
    
    for (const query of queries) {
      try {
        console.log(`Ejecutando: ${query.substring(0, 50)}...`);
        await pool.query(query);
      } catch (qErr) {
        // Ignorar el error si la columna ya existe (Duplicate column name)
        if (qErr.code === 'ER_DUP_FIELDNAME') {
          console.log('La columna ya existe, omitiendo...');
        } else {
          throw qErr;
        }
      }
    }
    
    console.log('✅ Migracion de base de datos completada exitosamente.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migracion:', error);
    process.exit(1);
  }
}

runMigration();