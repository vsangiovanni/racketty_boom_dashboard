const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

const backendDir = path.join(__dirname, '..', 'backend');
const envCandidates = [
  path.join(backendDir, '.env'),
  path.join(backendDir, '.env.production'),
  path.join(backendDir, '.env.produccion')
];

for (const p of envCandidates) {
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false });
}

function buildMysqlConfig() {
  const uri = String(process.env.DATABASE_URL || process.env.MYSQL_URL || '').trim();
  if (uri && /^mysql:\/\//i.test(uri)) {
    return { uri, namedPlaceholders: true };
  }
  return {
    host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || process.env.MYSQL_USER || '',
    password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQL_DATABASE || '',
    namedPlaceholders: true
  };
}

async function main() {
  const pool = mysql.createPool(buildMysqlConfig());
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        type ENUM('Vendor','Customer','Both') NOT NULL DEFAULT 'Vendor',
        notes TEXT NULL,
        address VARCHAR(255) NULL,
        email VARCHAR(190) NULL,
        phone VARCHAR(50) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_vendor_name (name),
        KEY idx_vendor_active (active),
        KEY idx_vendor_type_active (type, active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    try {
      await pool.query('ALTER TABLE transactions ADD COLUMN vendor_id BIGINT UNSIGNED NULL AFTER vendor');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    try {
      await pool.query(
        'ALTER TABLE transactions ADD CONSTRAINT fk_transactions_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL'
      );
    } catch (e) {
      // Ignorar si ya existe la FK o no aplica en esta instalacion.
    }

    const [distinctRows] = await pool.query(
      "SELECT DISTINCT TRIM(vendor) AS name FROM transactions WHERE vendor IS NOT NULL AND TRIM(vendor) <> '' ORDER BY name ASC"
    );

    let insertedVendors = 0;
    for (const row of distinctRows) {
      const name = String(row.name || '').trim();
      if (!name) continue;
      const [result] = await pool.query(
        "INSERT IGNORE INTO vendors (name, type, active) VALUES (:name, 'Vendor', 1)",
        { name }
      );
      insertedVendors += Number(result.affectedRows || 0);
    }

    const [linkResult] = await pool.query(
      "UPDATE transactions t JOIN vendors v ON TRIM(t.vendor) = v.name SET t.vendor_id = v.id WHERE t.vendor_id IS NULL AND t.vendor IS NOT NULL AND TRIM(t.vendor) <> ''"
    );
    const [totalRows] = await pool.query('SELECT COUNT(*) AS n FROM vendors');

    console.log(
      JSON.stringify(
        {
          distinctVendorsInLedger: distinctRows.length,
          insertedVendors,
          linkedTransactions: Number(linkResult.affectedRows || 0),
          totalVendorsNow: Number(totalRows[0].n || 0)
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
