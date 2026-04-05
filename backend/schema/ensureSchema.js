'use strict';

function createSchemaApi(pool) {
async function ensureQuoteRequestsTeamViewedColumn() {
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_requests' AND COLUMN_NAME = 'team_first_viewed_at'`
    );
    if (cols && cols.length) return;
    await pool.query(
      `ALTER TABLE quote_requests ADD COLUMN team_first_viewed_at TIMESTAMP NULL DEFAULT NULL AFTER internal_notes`
    );
    await pool.query(
      `UPDATE quote_requests SET team_first_viewed_at = NOW() WHERE team_first_viewed_at IS NULL`
    );
    console.log('[schema] quote_requests.team_first_viewed_at added; existing rows marked seen.');
  } catch (e) {
    console.warn('[schema] quote_requests team_first_viewed_at migration:', e && e.message);
  }
}

async function backfillVendorsFromTransactions() {
  try {
    const [distinctRows] = await pool.query(
      "SELECT DISTINCT TRIM(vendor) AS name FROM transactions WHERE vendor IS NOT NULL AND TRIM(vendor) <> '' ORDER BY name ASC"
    );
    let inserted = 0;
    for (const row of distinctRows || []) {
      const name = String(row.name || '').trim();
      if (!name) continue;
      const [res] = await pool.query(
        "INSERT IGNORE INTO vendors (name, type, active) VALUES (:name, 'Vendor', 1)",
        { name }
      );
      inserted += Number(res && res.affectedRows ? res.affectedRows : 0);
    }

    const [linkRes] = await pool.query(
      "UPDATE transactions t JOIN vendors v ON TRIM(t.vendor) = v.name SET t.vendor_id = v.id WHERE t.vendor_id IS NULL AND t.vendor IS NOT NULL AND TRIM(t.vendor) <> ''"
    );
    console.log(
      '[schema] vendors backfill:',
      JSON.stringify({
        distinctFromLedger: Number((distinctRows || []).length || 0),
        insertedVendors: inserted,
        linkedTransactions: Number(linkRes && linkRes.affectedRows ? linkRes.affectedRows : 0)
      })
    );
  } catch (e) {
    console.warn('[schema] vendors backfill failed:', e && e.message);
  }
}

/**
 * El ledger y los reportes muestran `transactions.vendor` (texto). Al renombrar en `vendors`,
 * hay que propagar el nombre al ledger y borradores AI para que dashboard/import/proyectos coincidan.
 */
async function propagateVendorRenameToLedger(vendorId, oldName, newName) {
  const o = String(oldName || '').trim();
  const n = String(newName || '').trim();
  if (!vendorId || !o || !n || o === n) {
    return { transactionsByFk: 0, transactionsOrphans: 0, receiptDrafts: 0 };
  }
  const [r1] = await pool.query('UPDATE transactions SET vendor = :n WHERE vendor_id = :id', {
    n,
    id: vendorId
  });
  const [r2] = await pool.query(
    'UPDATE transactions SET vendor = :n, vendor_id = :id WHERE vendor_id IS NULL AND TRIM(vendor) = :o',
    { n, id: vendorId, o }
  );
  let drafts = 0;
  try {
    const [r3] = await pool.query('UPDATE receipt_extraction_drafts SET vendor = :n WHERE TRIM(vendor) = :o', {
      n,
      o
    });
    drafts = Number(r3.affectedRows || 0);
  } catch (e) {
    console.warn('[vendors] receipt_extraction_drafts rename skipped:', e && e.message);
  }
  console.log(
    '[vendors] rename propagated:',
    JSON.stringify({
      vendorId,
      from: o,
      to: n,
      transactionsByFk: Number(r1.affectedRows || 0),
      transactionsOrphansLinked: Number(r2.affectedRows || 0),
      receiptDrafts: drafts
    })
  );
  return {
    transactionsByFk: Number(r1.affectedRows || 0),
    transactionsOrphans: Number(r2.affectedRows || 0),
    receiptDrafts: drafts
  };
}

const DEFAULT_LOCATION_SEEDS = [
  ['Centralia', 10],
  ['Chehalis', 20],
  ['Pe Ell', 30],
  ['Mossyrock', 40],
  ['Onalaska', 50],
  ['Tumwater', 60],
  ['Olympia', 70],
  ['Lacey', 80],
  ['Bucoda', 90]
];

async function seedDefaultLocations() {
  try {
    let n = 0;
    for (const [name, sort_order] of DEFAULT_LOCATION_SEEDS) {
      const [r] = await pool.query(
        'INSERT IGNORE INTO locations (name, sort_order) VALUES (:name, :sort_order)',
        { name, sort_order }
      );
      n += Number(r && r.affectedRows ? r.affectedRows : 0);
    }
    if (n) console.log('[schema] locations seed inserted:', n);
  } catch (e) {
    console.warn('[schema] locations seed failed:', e && e.message);
  }
}

async function backfillLocationsFromTransactions() {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT TRIM(location) AS loc FROM transactions
       WHERE location IS NOT NULL AND TRIM(location) <> ''`
    );
    let inserted = 0;
    for (const row of rows || []) {
      const loc = String(row.loc || '').trim();
      if (!loc) continue;
      const [r] = await pool.query(
        'INSERT IGNORE INTO locations (name, sort_order) VALUES (:name, 500)',
        { name: loc }
      );
      inserted += Number(r && r.affectedRows ? r.affectedRows : 0);
    }
    if (inserted) {
      console.log('[schema] locations from transactions:', inserted);
    }
  } catch (e) {
    console.warn('[schema] locations backfill failed:', e && e.message);
  }
}

/**
 * Esquema MySQL real de la app: creacion idempotente (CREATE IF NOT EXISTS) y ALTER
 * tolerantes a ER_DUP_FIELDNAME / FK ya existente para instalaciones previas.
 *
 * Orden de dependencias: receipt_uploads -> receipt_extraction_drafts; categories,
 * vendors, locations; quote_requests (+ team_first_viewed_at); projects; app_users;
 * import_batches; settings (con app_pin, logo, avatar, approval_threshold);
 * project_budgets / project_budget_categories; audit_logs; transactions (todas las
 * columnas del ledger + FK vendor_id, import_batch_id, project, category, receipt);
 * review_flags -> transactions.
 *
 * La fase interna solo aplica ALTER legacy, FKs opcionales y seeds (locations, vendors).
 */
async function ensureSchema() {
  // --- Tablas base (orden FK) ---
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_uploads (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      original_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL,
      storage_path VARCHAR(500) NOT NULL,
      storage_url VARCHAR(500) NOT NULL,
      status ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_extraction_drafts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      receipt_id BIGINT UNSIGNED NOT NULL,
      provider VARCHAR(50) NOT NULL,
      vendor VARCHAR(255) NULL,
      transaction_date DATE NULL,
      amount DECIMAL(12,2) NULL,
      category VARCHAR(100) NULL,
      type ENUM('Income','Expense') NULL,
      raw_json JSON NULL,
      review_state ENUM('pending','approved','edited') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_receipt_draft (receipt_id),
      CONSTRAINT fk_draft_receipt FOREIGN KEY (receipt_id) REFERENCES receipt_uploads(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_category_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 100,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_location_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS quote_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_name VARCHAR(180) NOT NULL,
      email VARCHAR(190) NULL,
      phone VARCHAR(50) NULL,
      service_type VARCHAR(120) NULL,
      project_address VARCHAR(255) NULL,
      preferred_contact VARCHAR(20) NULL,
      estimated_budget VARCHAR(60) NULL,
      message TEXT NULL,
      status ENUM('new','contacted','scheduled','won','lost') NOT NULL DEFAULT 'new',
      internal_notes TEXT NULL,
      team_first_viewed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_quote_status (status),
      INDEX idx_quote_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureQuoteRequestsTeamViewedColumn();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      status ENUM('Active','Completed') NOT NULL DEFAULT 'Active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_project_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Fuera del try de Fase 1: login multi-usuario depende de esta tabla; si Fase 1 falla a medias, /api/auth/options no debe romper.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      display_name VARCHAR(120) NOT NULL,
      role ENUM('Admin','Manager','Viewer') NOT NULL DEFAULT 'Manager',
      pin_hash CHAR(64) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_app_users_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_file_name VARCHAR(255) NOT NULL,
      worksheet_name VARCHAR(100),
      total_rows_scanned INT DEFAULT 0,
      rows_ready INT DEFAULT 0,
      rows_imported INT DEFAULT 0,
      rows_skipped INT DEFAULT 0,
      rows_flagged INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_name VARCHAR(255) DEFAULT 'Racketty Boom Enterprises',
      default_currency VARCHAR(10) DEFAULT 'USD',
      default_tax_rate DECIMAL(5,2) DEFAULT 0.00,
      approval_threshold DECIMAL(12,2) DEFAULT 5000.00,
      date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
      app_pin VARCHAR(20) NULL DEFAULT NULL,
      logo_url VARCHAR(500) NULL,
      avatar_url VARCHAR(500) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_budgets (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      project_id BIGINT UNSIGNED NOT NULL,
      total_budget DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      committed_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      warning_percent DECIMAL(5,2) NOT NULL DEFAULT 80.00,
      overrun_percent DECIMAL(5,2) NOT NULL DEFAULT 100.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_project_budget_project (project_id),
      CONSTRAINT fk_project_budgets_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_budget_categories (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      project_id BIGINT UNSIGNED NOT NULL,
      category_name VARCHAR(120) NOT NULL,
      budget_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_project_category_budget (project_id, category_name),
      CONSTRAINT fk_project_budget_categories_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      entity VARCHAR(100) NOT NULL,
      entity_id VARCHAR(100) NULL,
      actor_role VARCHAR(50) NOT NULL,
      actor_ip VARCHAR(64) NULL,
      details_json JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      receipt_id BIGINT UNSIGNED NULL,
      category_id BIGINT UNSIGNED NULL,
      project_id BIGINT UNSIGNED NULL,
      vendor VARCHAR(255) NOT NULL,
      vendor_id BIGINT UNSIGNED NULL,
      customer_name VARCHAR(255) NULL,
      transaction_date DATE NOT NULL,
      invoice_number VARCHAR(100) NULL,
      items TEXT NULL,
      amount DECIMAL(12,2) NOT NULL,
      subtotal DECIMAL(12,2) DEFAULT 0.00,
      sales_tax_paid DECIMAL(12,2) DEFAULT 0.00,
      sales_tax_owed DECIMAL(12,2) DEFAULT 0.00,
      tax DECIMAL(12,2) DEFAULT 0.00,
      type ENUM('Income','Expense') NOT NULL,
      payment_method VARCHAR(50) NULL,
      location VARCHAR(100) NULL,
      notes TEXT NULL,
      source_file_name VARCHAR(255) NULL,
      extraction_status VARCHAR(50) DEFAULT 'manual',
      review_status VARCHAR(50) DEFAULT 'pending',
      import_batch_id BIGINT UNSIGNED NULL,
      source_row_number INT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_transactions_receipt_id (receipt_id),
      KEY idx_transactions_category_id (category_id),
      KEY idx_transactions_project_id (project_id),
      CONSTRAINT fk_transactions_receipt FOREIGN KEY (receipt_id) REFERENCES receipt_uploads(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS review_flags (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      transaction_id BIGINT UNSIGNED NOT NULL,
      flag_type VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      severity ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_review_flags_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    console.log('Aplicando migracion Fase 1 a la base de datos...');

    try {
      await pool.query('DROP TABLE IF EXISTS project_invoices');
    } catch (_e) {}

    try {
      await pool.query('DROP TABLE IF EXISTS project_execution_updates');
    } catch (_e) {}

    try {
      await pool.query(`
        ALTER TABLE review_flags
        ADD CONSTRAINT fk_review_flags_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      `);
    } catch (_e) {
      // Ya existe o tabla legacy distinta
    }

    try {
      await pool.query(`
        ALTER TABLE transactions
        ADD COLUMN customer_name VARCHAR(255) NULL AFTER vendor,
        ADD COLUMN invoice_number VARCHAR(100) NULL AFTER transaction_date,
        ADD COLUMN items TEXT NULL AFTER invoice_number,
        ADD COLUMN subtotal DECIMAL(12,2) DEFAULT 0.00 AFTER amount,
        ADD COLUMN sales_tax_paid DECIMAL(12,2) DEFAULT 0.00 AFTER subtotal,
        ADD COLUMN sales_tax_owed DECIMAL(12,2) DEFAULT 0.00 AFTER sales_tax_paid,
        ADD COLUMN tax DECIMAL(12,2) DEFAULT 0.00 AFTER sales_tax_owed,
        ADD COLUMN payment_method VARCHAR(50) NULL,
        ADD COLUMN location VARCHAR(100) NULL,
        ADD COLUMN source_file_name VARCHAR(255) NULL,
        ADD COLUMN extraction_status VARCHAR(50) DEFAULT 'manual',
        ADD COLUMN review_status VARCHAR(50) DEFAULT 'pending',
        ADD COLUMN import_batch_id BIGINT UNSIGNED NULL,
        ADD COLUMN source_row_number INT NULL;
      `);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    try {
      await pool.query(`
        ALTER TABLE vendors
        ADD COLUMN address VARCHAR(255) NULL AFTER notes,
        ADD COLUMN email VARCHAR(190) NULL AFTER address,
        ADD COLUMN phone VARCHAR(50) NULL AFTER email;
      `);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    try {
      await pool.query(`
        ALTER TABLE transactions
        ADD COLUMN vendor_id BIGINT UNSIGNED NULL AFTER vendor;
      `);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    try {
      await pool.query(`
        ALTER TABLE transactions
        ADD CONSTRAINT fk_transactions_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;
      `);
    } catch (e) {
      // Ignorar si la foreign key ya existe o si la tabla vendors aun no esta disponible.
    }

    try {
      await pool.query(`
        ALTER TABLE transactions
        ADD CONSTRAINT fk_transactions_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
      `);
    } catch (e) {
      // Ignorar si la foreign key o el indice ya existe
    }

    try {
      await pool.query(`
        ALTER TABLE settings
        ADD COLUMN app_pin VARCHAR(20) DEFAULT NULL,
        ADD COLUMN logo_url VARCHAR(500) NULL,
        ADD COLUMN avatar_url VARCHAR(500) NULL;
      `);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    // Si la columna ya existia con un DEFAULT antiguo, lo ajustamos a NULL.
    try {
      await pool.query(`
        ALTER TABLE settings
        MODIFY app_pin VARCHAR(20) NULL DEFAULT NULL;
      `);
    } catch (e) {
      // Ignorar si la columna no existe todavia.
    }

    try {
      await pool.query(`
        ALTER TABLE settings
        ADD COLUMN approval_threshold DECIMAL(12,2) DEFAULT 5000.00;
      `);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    try {
      await pool.query(`
        ALTER TABLE transactions
        ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER category_id;
      `);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }

    try {
      await pool.query(`
        ALTER TABLE transactions
        ADD CONSTRAINT fk_transactions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
      `);
    } catch (e) {}

    try {
      await pool.query(`INSERT INTO settings (id, business_name, app_pin) VALUES (1, 'Racketty Boom Enterprises', NULL) ON DUPLICATE KEY UPDATE id=id;`);
    } catch (e) {}

    await seedDefaultLocations();
    await backfillLocationsFromTransactions();
    await backfillVendorsFromTransactions();

    console.log('✅ Migracion completada.');
  } catch (err) {
    console.error('❌ Error aplicando migracion:', err.message);
  }
}

  return { ensureSchema, propagateVendorRenameToLedger };
}

module.exports = { createSchemaApi };
