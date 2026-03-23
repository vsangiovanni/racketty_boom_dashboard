const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');

dotenv.config();

const EXCEL_PATH = process.argv[2] || 'C:/Users/PC/.openclaw/media/inbound/12_INCOME_AND_EXPENSE_2025_-_December---b54f9c51-7ee7-470e-bad5-f2e4df40180f.xlsx';

const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  namedPlaceholders: true
};

function asDateYMD(value) {
  if (!value && value !== 0) return null;

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeHeader(text) {
  return String(text || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
    const normalized = (rows[i] || []).map(normalizeHeader);
    if (normalized.includes('DATE') && normalized.includes('COST') && normalized.includes('INCOME') && normalized.includes('PAY TO:')) {
      return i;
    }
  }
  return -1;
}

function mapIndexes(header) {
  const norm = header.map(normalizeHeader);
  return {
    date: norm.indexOf('DATE'),
    cost: norm.indexOf('COST'),
    income: norm.indexOf('INCOME'),
    vendor: norm.indexOf('PAY TO:'),
    item: norm.indexOf('ITEM(S)'),
    notes: norm.indexOf('NOTES:')
  };
}

function pickCategory(row, idx) {
  const item = idx.item >= 0 ? String(row[idx.item] || '').trim() : '';
  const notes = idx.notes >= 0 ? String(row[idx.notes] || '').trim() : '';
  return item || notes || 'General';
}

async function createPoolEnsured() {
  try {
    const probePool = mysql.createPool(DB_CONFIG);
    await probePool.query('SELECT 1');
    await probePool.end();
    return mysql.createPool(DB_CONFIG);
  } catch (error) {
    if (!String(error.message || '').includes('Unknown database')) throw error;

    const bootstrap = await mysql.createConnection({
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
      namedPlaceholders: true
    });

    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();

    return mysql.createPool(DB_CONFIG);
  }
}

async function ensureTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_category_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      category_id BIGINT UNSIGNED NULL,
      vendor VARCHAR(255) NOT NULL,
      transaction_date DATE NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      type ENUM('Income','Expense') NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_transactions_category_id (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

function parseWorkbookTransactions(workbook) {
  const parsedTransactions = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const headerRowIndex = detectHeaderRow(rows);
    if (headerRowIndex < 0) continue;

    const idx = mapIndexes(rows[headerRowIndex]);
    if (idx.date < 0 || idx.cost < 0 || idx.income < 0 || idx.vendor < 0) continue;

    for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const date = asDateYMD(row[idx.date]);
      const vendor = String(row[idx.vendor] || '').trim();
      const cost = Number(row[idx.cost] || 0);
      const income = Number(row[idx.income] || 0);

      if (!date || !vendor) continue;

      if (Number.isFinite(cost) && cost > 0) {
        parsedTransactions.push({ vendor, date, amount: Number(cost.toFixed(2)), category: pickCategory(row, idx), type: 'Expense', sourceSheet: sheetName });
      }

      if (Number.isFinite(income) && income > 0) {
        parsedTransactions.push({ vendor, date, amount: Number(income.toFixed(2)), category: pickCategory(row, idx), type: 'Income', sourceSheet: sheetName });
      }
    }
  }

  return parsedTransactions;
}

async function run() {
  const workbook = XLSX.readFile(path.resolve(EXCEL_PATH), { cellDates: false, raw: true });
  const parsedTransactions = parseWorkbookTransactions(workbook);

  if (!parsedTransactions.length) {
    throw new Error('No historical transactions found in workbook. Verify sheet format.');
  }

  const pool = await createPoolEnsured();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await ensureTables(connection);

    let inserted = 0;
    for (const tx of parsedTransactions) {
      await connection.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', { name: tx.category });
      const [categoryRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      const categoryId = categoryRows[0].id;

      const [dupeRows] = await connection.query(
        `SELECT id FROM transactions
         WHERE vendor = :vendor AND transaction_date = :transactionDate AND amount = :amount AND type = :type
         LIMIT 1`,
        { vendor: tx.vendor, transactionDate: tx.date, amount: tx.amount, type: tx.type }
      );

      if (dupeRows.length) continue;

      await connection.query(
        `INSERT INTO transactions (category_id, vendor, transaction_date, amount, type, notes)
         VALUES (:categoryId, :vendor, :transactionDate, :amount, :type, :notes)`,
        {
          categoryId,
          vendor: tx.vendor,
          transactionDate: tx.date,
          amount: tx.amount,
          type: tx.type,
          notes: `[Excel Import] Source sheet: ${tx.sourceSheet}`
        }
      );

      inserted += 1;
    }

    await connection.commit();
    console.log(`Import completed. Parsed: ${parsedTransactions.length}, Inserted: ${inserted}.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Import failed:', error.message);
  process.exit(1);
});
