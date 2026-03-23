const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixColumns() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'greg_tracker'
  });

  try {
    await pool.query(`ALTER TABLE transactions ADD COLUMN items TEXT NULL AFTER invoice_number;`);
    console.log('✅ Columna items agregada.');
  } catch(e) { console.log(e.code); }
  
  try {
    await pool.query(`ALTER TABLE transactions ADD COLUMN sales_tax_paid DECIMAL(12,2) DEFAULT 0.00 AFTER subtotal;`);
    console.log('✅ Columna sales_tax_paid agregada.');
  } catch(e) { console.log(e.code); }

  try {
    await pool.query(`ALTER TABLE transactions ADD COLUMN sales_tax_owed DECIMAL(12,2) DEFAULT 0.00 AFTER sales_tax_paid;`);
    console.log('✅ Columna sales_tax_owed agregada.');
  } catch(e) { console.log(e.code); }

  process.exit(0);
}

fixColumns();