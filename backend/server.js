const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const multer = require('multer');
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const ExcelImportService = require('./services/excelImportService');

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 10);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const DEFAULT_COMPANY_NAME = process.env.DEFAULT_COMPANY_NAME || 'Racketty Boom Enterprises';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  namedPlaceholders: true
});

fs.mkdirSync(path.resolve(process.cwd(), UPLOAD_DIR), { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(`/${UPLOAD_DIR}`, express.static(path.resolve(process.cwd(), UPLOAD_DIR)));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve(process.cwd(), UPLOAD_DIR));
  },
  filename: (_req, file, cb) => {
    const safeOriginal = file.originalname.replace(/\s+/g, '_');
    cb(null, `${Date.now()}_${safeOriginal}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Only image files are allowed.'));
  }
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream'
    ]);
    const original = String(file.originalname || '').toLowerCase();
    if (allowedMimes.has(file.mimetype) || original.endsWith('.xlsx') || original.endsWith('.xls')) {
      return cb(null, true);
    }
    return cb(new Error('Only .xlsx or .xls files are allowed.'));
  }
});

function normalizeType(typeValue) {
  const raw = String(typeValue || '').trim().toLowerCase();
  if (raw === 'income') return 'Income';
  if (raw === 'expense') return 'Expense';
  return null;
}

function excelDateToIso(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const asString = String(value).trim();
  if (!asString) return null;

  const date = new Date(asString);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  return null;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[:]/g, '')
    .replace(/\s+/g, ' ');
}

function pickCellValue(row, headerAliases) {
  const aliases = headerAliases.map((h) => normalizeHeader(h));
  for (const key of Object.keys(row || {})) {
    const normalized = normalizeHeader(key);
    if (aliases.includes(normalized)) return row[key];
  }
  return null;
}

function scoreHeaderRow(rowValues) {
  const normalizedCells = (rowValues || []).map((cell) => normalizeHeader(cell));

  const hasDate = normalizedCells.some((cell) => cell === 'date' || cell.includes('transaction date'));
  const hasVendor = normalizedCells.some((cell) =>
    ['pay to', 'pay to:', 'payto', 'vendor', 'merchant', 'description'].includes(cell)
  );
  const hasAmount = normalizedCells.some((cell) =>
    ['cost/income', 'amount', 'cost', 'income'].includes(cell)
  );
  const hasCategory = normalizedCells.some((cell) =>
    ['category/items', 'category', 'items'].includes(cell)
  );

  return [hasDate, hasVendor, hasAmount, hasCategory].filter(Boolean).length;
}

function extractRowsFromSheetWithDynamicHeader(sheet) {
  const matrix = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false
  });

  if (!matrix.length) {
    return { rows: [], headerRowIndex: -1, headerScore: 0 };
  }

  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < Math.min(matrix.length, 50); i += 1) {
    const score = scoreHeaderRow(matrix[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestScore < 2) {
    return { rows: [], headerRowIndex: -1, headerScore: bestScore };
  }

  const headers = matrix[bestIndex].map((cell) => String(cell ?? '').trim());
  const rows = [];

  for (let i = bestIndex + 1; i < matrix.length; i += 1) {
    const values = matrix[i] || [];
    const rowObj = {};
    let hasValue = false;

    for (let c = 0; c < headers.length; c += 1) {
      const header = headers[c];
      if (!header) continue;
      const value = values[c] ?? null;
      if (value !== null && String(value).trim() !== '') hasValue = true;
      rowObj[header] = value;
    }

    if (hasValue) rows.push(rowObj);
  }

  return { rows, headerRowIndex: bestIndex, headerScore: bestScore };
}

function pickBestSheetRows(workbook) {
  let best = {
    sheetName: workbook.SheetNames?.[0] || null,
    rows: [],
    headerRowIndex: -1,
    headerScore: 0
  };

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const parsed = extractRowsFromSheetWithDynamicHeader(sheet);

    if (parsed.headerScore > best.headerScore) {
      best = {
        sheetName,
        rows: parsed.rows,
        headerRowIndex: parsed.headerRowIndex,
        headerScore: parsed.headerScore
      };
    }
  }

  if (!best.rows.length && best.sheetName) {
    const fallbackSheet = workbook.Sheets[best.sheetName];
    best.rows = xlsx.utils.sheet_to_json(fallbackSheet, {
      defval: null,
      raw: true,
      blankrows: false
    });
  }

  return best;
}

function importAsDateYMD(value) {
  if (!value && value !== 0) return null;

  if (typeof value === 'number') {
    const parsed = xlsx.SSF.parse_date_code(value);
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

function importNormalizeHeader(text) {
  return String(text || '')
    .trim()
    .toUpperCase()
    .replace(/[.:]/g, '')
    .replace(/\s+/g, ' ');
}

function parseImportAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const cleaned = String(value)
    .replace(/[$,]/g, '')
    .replace(/\(([^)]+)\)/, '-$1')
    .trim();

  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function detectImportHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const row = rows[i] || [];
    const colA = importNormalizeHeader(row[0]);
    const colB = importNormalizeHeader(row[1]);

    if (colA.includes('DATE') && colB.includes('COST')) {
      return i;
    }
  }
  return -1;
}

function mapImportIndexes(header) {
  const norm = (header || []).map(importNormalizeHeader);
  const findIndex = (terms) => norm.findIndex((h) => terms.some((term) => h.includes(term)));

  const date = findIndex(['DATE']);
  const cost = findIndex(['COST']);
  const income = findIndex(['INCOME']);
  const vendor = findIndex(['PAY TO', 'VENDOR', 'PAYEE']);
  const category = findIndex(['ITEM', 'CATEGORY']);

  return {
    date: date >= 0 ? date : 0,
    cost: cost >= 0 ? cost : 1,
    income: income >= 0 ? income : 2,
    vendor: vendor >= 0 ? vendor : 5,
    categoryPrimary: category >= 0 ? category : 6,
    categoryFallback: category === 6 ? 7 : 6
  };
}

function pickImportCategory(row, idx) {
  const primary = String(row[idx.categoryPrimary] || '').trim();
  const fallback = String(row[idx.categoryFallback] || '').trim();
  return primary || fallback || 'General';
}

function parseWorkbookTransactions(workbook) {
  const parsedTransactions = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
    const headerRowIndex = detectImportHeaderRow(rows);
    if (headerRowIndex < 0) continue;

    const idx = mapImportIndexes(rows[headerRowIndex]);

    for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const date = importAsDateYMD(row[idx.date]);
      const vendor = String(row[idx.vendor] || '').trim();
      const cost = parseImportAmount(row[idx.cost]);
      const income = parseImportAmount(row[idx.income]);

      if (!date || (!vendor && !cost && !income)) continue;
      if (!vendor) continue;

      if (Number.isFinite(cost) && cost > 0) {
        parsedTransactions.push({
          vendor,
          date,
          amount: Number(cost.toFixed(2)),
          category: pickImportCategory(row, idx),
          type: 'Expense',
          sourceSheet: sheetName
        });
      }

      if (Number.isFinite(income) && income > 0) {
        parsedTransactions.push({
          vendor,
          date,
          amount: Number(income.toFixed(2)),
          category: pickImportCategory(row, idx),
          type: 'Income',
          sourceSheet: sheetName
        });
      }
    }
  }

  return parsedTransactions;
}

function parseStrictJson(text) {
  const cleaned = String(text || '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Vision model did not return valid JSON.');
  }
}

function normalizeAiPayload(payload) {
  const vendor = String(payload.vendor || '').trim();
  const date = payload.date ? String(payload.date).slice(0, 10) : null;
  const amount = Number(payload.amount) || 0;
  const category = String(payload.category || '').trim();
  const type = normalizeType(payload.type) || 'Expense';
  
  const subtotal = Number(payload.subtotal) || 0;
  const sales_tax_paid = Number(payload.sales_tax_paid) || 0;
  const sales_tax_owed = Number(payload.sales_tax_owed) || 0;
  const invoice_number = String(payload.invoice_number || '').trim();
  const items = String(payload.items || '').trim();

  if (!vendor || !date) {
    throw new Error('AI extraction missing required fields: vendor, date');
  }

  return {
    vendor,
    date,
    amount,
    category,
    type,
    subtotal,
    sales_tax_paid,
    sales_tax_owed,
    invoice_number,
    items
  };
}

async function extractWithOpenAI({ base64Image, mimeType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing.');

  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o';
  const prompt = [
    'Extract data from this receipt image.',
    'Return STRICT JSON only (no markdown, no commentary) with this exact shape:',
    '{"vendor":"string","date":"YYYY-MM-DD","amount":number,"category":"string","type":"Income|Expense"}',
    'Rules:',
    '- type must be exactly Income or Expense',
    '- amount must be a number using dot decimal separator',
    '- date must be valid YYYY-MM-DD',
    '- if uncertain, choose the best probable value but keep format strict'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${JSON.stringify(data)}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response did not include message content.');

  const parsed = parseStrictJson(content);
  return normalizeAiPayload(parsed);
}

async function extractWithGemini({ base64Image, mimeType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.0-flash';
  const prompt = [
    'Extract data from this receipt or invoice image. Read carefully including bottom sections for order numbers.',
    'Output STRICT JSON only (no markdown) with exact keys:',
    '{"vendor":"string","date":"YYYY-MM-DD","subtotal":number,"sales_tax_paid":number,"sales_tax_owed":number,"amount":number,"invoice_number":"string","items":"string","category":"string","type":"Income|Expense"}',
    'Rules:',
    '- type: "Expense" if it is a purchase/receipt. "Income" if it is an invoice billed to a client.',
    '- amount: The Grand Total.',
    '- sales_tax_paid: Tax amount charged on purchases (Expenses).',
    '- sales_tax_owed: Tax amount billed to clients (Income).',
    '- invoice_number: Capture order numbers, invoice numbers, or ticket numbers.',
    '- items: A brief summary of the main items or services.',
    '- category: Guess the best category (e.g., Building Materials, Utilities, Fuel & Mileage, Office Supplies).'
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1alpha/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json'
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Image
              }
            }
          ]
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${JSON.stringify(data)}`);
  }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini response did not include content text.');

  const parsed = parseStrictJson(content);
  return normalizeAiPayload(parsed);
}

/**
 * Vision AI extraction
 * returns: { vendor, date, amount, category, type }
 */
async function extractReceiptDataWithAI({ imagePath, mimeType }) {
  const provider = (process.env.VISION_PROVIDER || 'openai').toLowerCase();
  const imageBuffer = await fs.promises.readFile(imagePath);
  const base64Image = imageBuffer.toString('base64');

  if (provider === 'gemini') {
    return extractWithGemini({ base64Image, mimeType });
  }

  return extractWithOpenAI({ base64Image, mimeType });
}

let transactionsCompanyColumnCheck = null;

async function hasTransactionsCompanyColumn(connection) {
  if (transactionsCompanyColumnCheck !== null) return transactionsCompanyColumnCheck;

  const dbName = process.env.DB_NAME;
  const sql = dbName
    ? `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = :dbName
        AND TABLE_NAME = 'transactions'
        AND COLUMN_NAME = 'company'
      LIMIT 1
    `
    : `
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'transactions'
        AND COLUMN_NAME = 'company'
      LIMIT 1
    `;

  const [rows] = await connection.query(sql, dbName ? { dbName } : {});
  transactionsCompanyColumnCheck = rows.length > 0;
  return transactionsCompanyColumnCheck;
}

async function ensureSchema() {
  const fs = require('fs');
  const path = require('path');
  
  // Tablas existentes
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
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      receipt_id BIGINT UNSIGNED NULL,
      category_id BIGINT UNSIGNED NULL,
      vendor VARCHAR(255) NOT NULL,
      transaction_date DATE NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      type ENUM('Income','Expense') NOT NULL,
      notes TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_transactions_receipt_id (receipt_id),
      KEY idx_transactions_category_id (category_id),
      CONSTRAINT fk_transactions_receipt FOREIGN KEY (receipt_id) REFERENCES receipt_uploads(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    console.log('Aplicando migracion Fase 1 a la base de datos...');
    
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
      CREATE TABLE IF NOT EXISTS review_flags (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        transaction_id BIGINT UNSIGNED NOT NULL,
        flag_type VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        severity ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_name VARCHAR(255) DEFAULT 'Racketty Boom Enterprises',
        default_currency VARCHAR(10) DEFAULT 'USD',
        default_tax_rate DECIMAL(5,2) DEFAULT 0.00,
        date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

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
        ALTER TABLE transactions
        ADD CONSTRAINT fk_transactions_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;
      `);
    } catch (e) {
      // Ignorar si la foreign key o el indice ya existe
    }

    console.log('✅ Migracion completada.');
  } catch (err) {
    console.error('❌ Error aplicando migracion:', err.message);
  }
}

app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    await pool.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE name=name', { name });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM categories WHERE id = :id', { id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'greg-tracker-backend', db: 'connected' });
  } catch (error) {
    console.error('Health check DB error:', error);
    res.status(500).json({ ok: false, service: 'greg-tracker-backend', db: 'disconnected' });
  }
});

/**
 * Upload endpoint (receipt/invoice photo)
 * Returns file metadata + AI extracted draft for review UI.
 */
app.post('/api/receipts/upload', upload.single('receipt'), async (req, res) => {
  let receiptId = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'receipt file is required.' });
    }

    const fileUrl = `${APP_BASE_URL}/${UPLOAD_DIR}/${req.file.filename}`;

    const [receiptInsert] = await pool.query(
      `
      INSERT INTO receipt_uploads (original_filename, mime_type, size_bytes, storage_path, storage_url, status)
      VALUES (:originalFilename, :mimeType, :sizeBytes, :storagePath, :storageUrl, 'draft')
      `,
      {
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storagePath: req.file.path,
        storageUrl: fileUrl
      }
    );

    receiptId = receiptInsert.insertId;

    const extractionDraft = await extractReceiptDataWithAI({
      imagePath: req.file.path,
      mimeType: req.file.mimetype
    });

    const provider = (process.env.VISION_PROVIDER || 'openai').toLowerCase();

    await pool.query(
      `
      INSERT INTO receipt_extraction_drafts
      (receipt_id, provider, vendor, transaction_date, amount, category, type, raw_json, review_state)
      VALUES
      (:receiptId, :provider, :vendor, :transactionDate, :amount, :category, :type, :rawJson, 'pending')
      ON DUPLICATE KEY UPDATE
        provider = VALUES(provider),
        vendor = VALUES(vendor),
        transaction_date = VALUES(transaction_date),
        amount = VALUES(amount),
        category = VALUES(category),
        type = VALUES(type),
        raw_json = VALUES(raw_json),
        review_state = 'pending'
      `,
      {
        receiptId,
        provider,
        vendor: extractionDraft.vendor,
        transactionDate: extractionDraft.date,
        amount: extractionDraft.amount,
        category: extractionDraft.category,
        type: extractionDraft.type,
        rawJson: JSON.stringify(extractionDraft)
      }
    );

    return res.status(201).json({
      message: 'Receipt uploaded. Review extracted data before saving transaction.',
      receipt: {
        id: receiptId,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storageUrl: fileUrl
      },
      draft: extractionDraft
    });
  } catch (error) {
    console.error('Upload error:', error);

    if (req.file?.path) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (_unlinkErr) {
        // ignore unlink errors
      }
    }

    if (receiptId) {
      try {
        await pool.query('DELETE FROM receipt_uploads WHERE id = :receiptId', { receiptId });
      } catch (_dbRollbackErr) {
        // ignore rollback errors
      }
    }

    return res.status(500).json({ error: error.message || 'Failed to process receipt upload.' });
  }
});

/**
 * Review/confirm endpoint.
 * Frontend sends edited extracted values; backend validates and persists transaction.
 */
app.post('/api/transactions/review-confirm', async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { receiptId, vendor, date, invoice_number, items, subtotal, sales_tax_paid, sales_tax_owed, total, category_id, category_name, type, notes, payment_method, location } = req.body;

    const normalizedType = normalizeType(type);
    const normalizedAmount = Number(total);

    if (!receiptId || !vendor || !date || !Number.isFinite(normalizedAmount) || !normalizedType) {
      return res.status(400).json({
        error: 'receiptId, vendor, date, amount, and type (Income/Expense) are required.'
      });
    }

    await connection.beginTransaction();

    const [receiptRows] = await connection.query(
      'SELECT id FROM receipt_uploads WHERE id = :receiptId FOR UPDATE',
      { receiptId }
    );

    if (!receiptRows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Receipt not found.' });
    }

    let finalCategoryId = category_id;
    if (!finalCategoryId && category_name) {
      await connection.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', { name: category_name });
      const [catRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      finalCategoryId = catRows[0].id;
    }

    const [transactionInsert] = await connection.query(
      `
      INSERT INTO transactions (receipt_id, category_id, vendor, invoice_number, items, transaction_date, subtotal, sales_tax_paid, sales_tax_owed, amount, type, payment_method, location, notes)
      VALUES (:receiptId, :categoryId, :vendor, :invoice_number, :items, :transactionDate, :subtotal, :sales_tax_paid, :sales_tax_owed, :amount, :type, :payment_method, :location, :notes)
      `,
      {
        receiptId,
        categoryId: finalCategoryId || null,
        vendor,
        invoice_number: invoice_number || null,
        items: items || null,
        transactionDate: String(date).slice(0, 10),
        subtotal: subtotal || 0,
        sales_tax_paid: sales_tax_paid || 0,
        sales_tax_owed: sales_tax_owed || 0,
        amount: normalizedAmount,
        type: normalizedType,
        payment_method: payment_method || null,
        location: location || null,
        notes: notes || null
      }
    );

    const [draftRows] = await connection.query(
      'SELECT vendor, transaction_date, amount, category, type FROM receipt_extraction_drafts WHERE receipt_id = :receiptId',
      { receiptId }
    );

    const draft = draftRows[0] || null;
    const edited =
      !draft ||
      String(draft.vendor || '') !== String(vendor || '') ||
      String(draft.transaction_date || '').slice(0, 10) !== String(date || '').slice(0, 10) ||
      Number(draft.amount || 0) !== normalizedAmount ||
      String(draft.type || '') !== normalizedType;

    await connection.query(
      `
      UPDATE receipt_extraction_drafts
      SET vendor = :vendor,
          transaction_date = :transactionDate,
          amount = :amount,
          type = :type,
          review_state = :reviewState,
          raw_json = :rawJson
      WHERE receipt_id = :receiptId
      `,
      {
        receiptId,
        vendor,
        transactionDate: String(date).slice(0, 10),
        amount: normalizedAmount,
        type: normalizedType,
        reviewState: edited ? 'edited' : 'approved',
        rawJson: JSON.stringify({ vendor, date: String(date).slice(0, 10), amount: normalizedAmount, type: normalizedType })
      }
    );

    await connection.query(
      'UPDATE receipt_uploads SET status = :status WHERE id = :receiptId',
      { status: 'confirmed', receiptId }
    );

    await connection.commit();

    return res.status(201).json({
      message: 'Transaction confirmed and saved.',
      transaction: { id: transactionInsert.insertId }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Review confirm error:', error);
    return res.status(500).json({ error: error.message || 'Failed to confirm transaction.' });
  } finally {
    connection.release();
  }
});

app.post('/api/import/preview', excelUpload.single('excel'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'excel file is required.' });
    }
    
    // Process workbook with the new robust service
    const parsedRows = ExcelImportService.parseWorkbook(req.file.buffer);
    
    const summary = {
      totalRows: parsedRows.length,
      ready: parsedRows.filter(r => r.status === 'Ready').length,
      needsReview: parsedRows.filter(r => r.status === 'Needs Review').length
    };

    return res.json({ success: true, summary, rows: parsedRows });
  } catch (error) {
    console.error('Excel preview error:', error);
    return res.status(500).json({ error: 'Failed to parse Excel file.' });
  }
});

app.post('/api/import/excel', excelUpload.single('excel'), async (req, res) => {
  const connection = await pool.getConnection();

  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'excel file is required.' });
    }

    const workbook = xlsx.read(req.file.buffer);

    if (!workbook.SheetNames?.length) {
      return res.status(400).json({ error: 'Excel file has no sheets.' });
    }

    const XLSX = xlsx;

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

    function parseWorkbookTransactionsLegacy(workbookArg) {
      const parsedTransactions = [];

      for (const sheetName of workbookArg.SheetNames) {
        const sheet = workbookArg.Sheets[sheetName];
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

    const parsedTransactions = parseWorkbookTransactionsLegacy(workbook);

    console.log('[Excel Import] Sheets:', workbook.SheetNames);
    console.log('[Excel Import] Parsed preview (first 5):', parsedTransactions.slice(0, 5));

    let processed = parsedTransactions.length;
    let inserted = 0;
    let duplicates = 0;

    const companyFieldExists = await hasTransactionsCompanyColumn(connection);

    await connection.beginTransaction();

    for (const tx of parsedTransactions) {
      const vendor = tx.vendor;
      const transactionDate = tx.date;
      const amount = tx.amount;
      const type = tx.type;
      const categoryName = tx.category || 'General';

      const [duplicateRows] = await connection.query(
        `
        SELECT id
        FROM transactions
        WHERE vendor = :vendor
          AND transaction_date = :transactionDate
          AND amount = :amount
          AND type = :type
          ${companyFieldExists ? 'AND company = :company' : ''}
        LIMIT 1
        `,
        {
          vendor,
          transactionDate,
          amount,
          type,
          ...(companyFieldExists ? { company: DEFAULT_COMPANY_NAME } : {})
        }
      );

      if (duplicateRows.length) {
        duplicates += 1;
        continue;
      }

      await connection.query(
        'INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
        { name: categoryName }
      );

      const [categoryIdRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      const categoryId = categoryIdRows[0].id;

      await connection.query(
        `
        INSERT INTO transactions (
          category_id,
          vendor,
          transaction_date,
          amount,
          type,
          notes
          ${companyFieldExists ? ', company' : ''}
        )
        VALUES (
          :categoryId,
          :vendor,
          :transactionDate,
          :amount,
          :type,
          :notes
          ${companyFieldExists ? ', :company' : ''}
        )
        `,
        {
          categoryId,
          vendor,
          transactionDate,
          amount,
          type,
          notes: `[Excel Import] Source sheet: ${tx.sourceSheet}`,
          ...(companyFieldExists ? { company: DEFAULT_COMPANY_NAME } : {})
        }
      );

      inserted += 1;
    }

    await connection.commit();

    return res.json({
      success: true,
      processed,
      inserted,
      duplicates,
      importMeta: {
        sheets: workbook.SheetNames,
        parsedCount: parsedTransactions.length
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Excel import error:', error);
    return res.status(500).json({ error: 'Failed to import Excel file.' });
  } finally {
    connection.release();
  }
});

app.get('/api/wipe', async (req, res) => {
  try {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('TRUNCATE TABLE review_flags');
    await pool.query('TRUNCATE TABLE transactions');
    await pool.query('TRUNCATE TABLE import_batches');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    res.send('<h2>✅ Base de datos completamente borrada.</h2><p><a href="/import.html">Volver a Importar Excel</a></p>');
  } catch (error) {
    res.status(500).send('Error borrando base de datos: ' + error.message);
  }
});

app.post('/api/transactions', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { type, vendor, date, invoice_number, items, subtotal, sales_tax_paid, sales_tax_owed, total, category_id, category_name, payment_method, location, notes } = req.body;
    if (!type || !vendor || !date || total === undefined) {
      return res.status(400).json({ error: 'Missing required fields: type, vendor, date, total' });
    }
    
    await connection.beginTransaction();
    
    let finalCategoryId = category_id;
    if (!finalCategoryId && category_name) {
      await connection.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', { name: category_name });
      const [catRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      finalCategoryId = catRows[0].id;
    }

    const [txResult] = await connection.query(
      `INSERT INTO transactions 
       (category_id, vendor, invoice_number, items, transaction_date, subtotal, sales_tax_paid, sales_tax_owed, amount, type, payment_method, location, notes, extraction_status, review_status)
       VALUES (:categoryId, :vendor, :invoice_number, :items, :date, :subtotal, :sales_tax_paid, :sales_tax_owed, :amount, :type, :payment_method, :location, :notes, 'manual', 'approved')`,
      { 
        categoryId: finalCategoryId || null, vendor, invoice_number: invoice_number || null, items: items || null, date, 
        subtotal: subtotal || 0, sales_tax_paid: sales_tax_paid || 0, sales_tax_owed: sales_tax_owed || 0, amount: total || 0, type, 
        payment_method: payment_method || null, location: location || null, notes: notes || null 
      }
    );
    
    await connection.commit();
    res.status(201).json({ success: true, id: txResult.insertId });
  } catch (error) {
    await connection.rollback();
    console.error('Manual insert error:', error);
    res.status(500).json({ error: 'Failed to save record' });
  } finally {
    connection.release();
  }
});

app.get('/api/transactions/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM transactions WHERE id = :id', { id: req.params.id });
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch record' });
  }
});

app.put('/api/transactions/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { type, vendor, date, invoice_number, items, subtotal, sales_tax_paid, sales_tax_owed, total, category_id, category_name, payment_method, location, notes } = req.body;
    if (!type || !vendor || !date || total === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    await connection.beginTransaction();
    
    let finalCategoryId = category_id;
    if (!finalCategoryId && category_name) {
      await connection.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', { name: category_name });
      const [catRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      finalCategoryId = catRows[0].id;
    }

    await connection.query(
      `UPDATE transactions SET 
        category_id = :categoryId, vendor = :vendor, invoice_number = :invoice_number, items = :items, 
        transaction_date = :date, subtotal = :subtotal, sales_tax_paid = :sales_tax_paid, 
        sales_tax_owed = :sales_tax_owed, amount = :amount, type = :type, 
        payment_method = :payment_method, location = :location, notes = :notes
       WHERE id = :id`,
      { 
        id: req.params.id, categoryId: finalCategoryId || null, vendor, invoice_number: invoice_number || null, items: items || null, date: date.slice(0, 10), 
        subtotal: subtotal || 0, sales_tax_paid: sales_tax_paid || 0, sales_tax_owed: sales_tax_owed || 0, amount: total || 0, type, 
        payment_method: payment_method || null, location: location || null, notes: notes || null 
      }
    );
    
    await connection.commit();
    res.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update record' });
  } finally {
    connection.release();
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM transactions WHERE id = :id', { id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.get('/api/transactions', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 15), 1), 500);
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM transactions');

    const [rows] = await pool.query(
      `
      SELECT
        t.id,
        t.vendor,
        t.transaction_date AS date,
        t.amount,
        t.type,
        t.notes,
        c.name AS category,
        t.created_at,
        t.review_status,
        ru.storage_url as receipt_url
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN receipt_uploads ru ON ru.id = t.receipt_id
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT :limit OFFSET :offset
      `,
      { limit, offset }
    );

    return res.json({ 
      transactions: rows,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Transactions list error:', error);
    return res.status(500).json({ error: 'Failed to fetch transactions.' });
  }
});

app.get('/api/cleanup', async (req, res) => {
  try {
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('TRUNCATE TABLE review_flags');
    await pool.query('TRUNCATE TABLE transactions');
    await pool.query('TRUNCATE TABLE import_batches');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');
    res.json({ success: true, message: 'All records deleted.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/import/commit', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { filename, rows } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'No rows to import.' });

    await connection.beginTransaction();

    const [batchResult] = await connection.query(
      `INSERT INTO import_batches (source_file_name, total_rows_scanned, rows_ready, rows_flagged)
       VALUES (:filename, :total, :ready, :flagged)`,
      {
        filename: filename || 'Unknown',
        total: rows.length,
        ready: rows.filter(r => r.status === 'Ready').length,
        flagged: rows.filter(r => r.status === 'Needs Review').length
      }
    );
    const batchId = batchResult.insertId;

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      if (!row.date || !row.vendor) { skipped++; continue; }

      const [dups] = await connection.query(
        'SELECT id FROM transactions WHERE vendor = :vendor AND transaction_date = :date AND ABS(amount - :amount) < 0.01 AND type = :type LIMIT 1',
        { vendor: row.vendor, date: row.date.slice(0, 10), amount: row.total || 0, type: row.type }
      );
      
      if (dups.length > 0) {
        skipped++;
        continue; 
      }

      await connection.query(
        'INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
        { name: row.category || 'General' }
      );
      const [catRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      const categoryId = catRows[0].id;

      const [txResult] = await connection.query(
        `INSERT INTO transactions
         (import_batch_id, source_row_number, category_id, vendor, invoice_number, items, transaction_date, subtotal, sales_tax_paid, sales_tax_owed, amount, type, notes, review_status)
         VALUES (:batchId, :source_row_number, :categoryId, :vendor, :invoice_number, :items, :transaction_date, :subtotal, :sales_tax_paid, :sales_tax_owed, :amount, :type, :notes, :review_status)`,
        {
          batchId,
          source_row_number: row.source_row_number,
          categoryId,
          vendor: row.vendor,
          invoice_number: row.invoice_number || null,
          items: row.items || null,
          transaction_date: row.date.slice(0, 10),
          subtotal: row.subtotal || 0,
          sales_tax_paid: row.sales_tax_paid || 0,
          sales_tax_owed: row.sales_tax_owed || 0,
          amount: row.total || 0,
          type: row.type,
          notes: row.notes || null,
          review_status: row.status === 'Needs Review' ? 'pending' : 'approved'
        }
      );

      if (row.flags && row.flags.length > 0) {
        for (const flag of row.flags) {
          await connection.query(
            `INSERT INTO review_flags (transaction_id, flag_type, message, severity) VALUES (:txId, :type, :msg, :severity)`,
            { txId: txResult.insertId, type: flag.type, msg: flag.msg, severity: flag.severity }
          );
        }
      }
      inserted++;
    }

    await connection.query(
      'UPDATE import_batches SET rows_imported = :inserted, rows_skipped = :skipped WHERE id = :batchId',
      { inserted, skipped, batchId }
    );

    await connection.commit();
    res.json({ success: true, batchId, inserted, skipped });
  } catch (error) {
    await connection.rollback();
    console.error('Commit error:', error);
    res.status(500).json({ error: 'Failed to commit import.' });
  } finally {
    connection.release();
  }
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const [[totals]] = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) AS totalIncome,
        COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS totalExpense
      FROM transactions
      `
    );

    const [recentTransactions] = await pool.query(
      `
      SELECT
        t.id,
        t.vendor,
        t.transaction_date AS date,
        t.amount,
        t.type,
        c.name AS category
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT 10
      `
    );

    const totalIncome = Number(totals.totalIncome || 0);
    const totalExpense = Number(totals.totalExpense || 0);

    return res.json({
      summary: {
        income: totalIncome,
        expense: totalExpense,
        balance: Number((totalIncome - totalExpense).toFixed(2))
      },
      recentTransactions
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard data.' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const filterType = req.query.filter || 'year';
    const filterValue = req.query.value || new Date().getFullYear();
    
    let dateFilterSql = 'YEAR(transaction_date) = ?';
    let sqlParams = [filterValue];

    if (filterType === 'month') {
      const [y, m] = String(filterValue).split('-');
      dateFilterSql = 'YEAR(transaction_date) = ? AND MONTH(transaction_date) = ?';
      sqlParams = [y, m];
    } else if (filterType === 'all') {
      dateFilterSql = '1=1';
      sqlParams = [];
    }

    const [[totals]] = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS expense,
        COALESCE(SUM(sales_tax_owed), 0) AS tax_owed,
        COALESCE(SUM(sales_tax_paid), 0) AS tax_paid
      FROM transactions
      WHERE ${dateFilterSql}
    `, sqlParams);

    const [monthly] = await pool.query(`
      SELECT 
        MONTH(transaction_date) as month,
        YEAR(transaction_date) as year,
        COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS expense
      FROM transactions
      WHERE ${dateFilterSql}
      GROUP BY YEAR(transaction_date), MONTH(transaction_date)
      ORDER BY year ASC, month ASC
    `, sqlParams);

    const [categories] = await pool.query(`
      SELECT c.name, SUM(t.amount) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE ${dateFilterSql} AND t.type = 'Expense'
      GROUP BY c.id, c.name
      ORDER BY total DESC
      LIMIT 5
    `, sqlParams);

    const [vendors] = await pool.query(`
      SELECT vendor, SUM(amount) as total
      FROM transactions
      WHERE ${dateFilterSql} AND type = 'Expense'
      GROUP BY vendor
      ORDER BY total DESC
      LIMIT 5
    `, sqlParams);

    const inc = Number(totals.income);
    const exp = Number(totals.expense);
    const margin = inc > 0 ? ((inc - exp) / inc) * 100 : 0;
    const taxLiability = Number(totals.tax_owed) - Number(totals.tax_paid);

    res.json({
      filterType, filterValue,
      summary: {
        income: inc,
        expense: exp,
        balance: inc - exp,
        margin: margin,
        tax_liability: taxLiability
      },
      monthly: monthly.map(m => ({ month: m.month, year: m.year, income: Number(m.income), expense: Number(m.expense) })),
      categories: categories.map(c => ({ name: c.name || 'General', total: Number(c.total) })),
      vendors: vendors.map(v => ({ name: v.vendor, total: Number(v.total) }))
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

const ExcelJS = require('exceljs');

app.get('/api/export', async (req, res) => {
  try {
    const filterType = req.query.filter || 'year';
    const filterValue = req.query.value || new Date().getFullYear();
    
    let dateFilterSql = 'YEAR(t.transaction_date) = ?';
    let sqlParams = [filterValue];
    let sheetTitle = `Racketty Boom Enterprises ${filterValue}`;

    if (filterType === 'month') {
      const [y, m] = String(filterValue).split('-');
      dateFilterSql = 'YEAR(t.transaction_date) = ? AND MONTH(t.transaction_date) = ?';
      sqlParams = [y, m];
      const monthName = new Date(y, m - 1).toLocaleString('en-US', { month: 'long' });
      sheetTitle = `Racketty Boom Enterprises  ${y} ${monthName}`;
    } else if (filterType === 'all') {
      dateFilterSql = '1=1';
      sqlParams = [];
      sheetTitle = 'Racketty Boom Enterprises  All Time';
    }

    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(t.transaction_date, '%m/%d/%Y') AS date,
        t.vendor,
        t.amount,
        t.type,
        t.subtotal,
        t.sales_tax_paid,
        t.sales_tax_owed,
        t.invoice_number,
        t.location,
        t.items,
        t.notes
      FROM transactions t
      WHERE ${dateFilterSql}
      ORDER BY t.transaction_date ASC, t.id ASC
    `, sqlParams);

    let totalCosts = 0;
    let grossIncome = 0;
    let totalTaxPaid = 0;
    let subTotalOwed = 0;
    let totalTaxOwed = 0;

    rows.forEach(r => {
      if (r.type === 'Expense') {
        totalCosts += Number(r.amount || 0);
        totalTaxPaid += Number(r.sales_tax_paid || 0);
      } else {
        grossIncome += Number(r.amount || 0);
        subTotalOwed += Number(r.subtotal || 0);
        totalTaxOwed += Number(r.sales_tax_owed || 0);
      }
    });

    const incomeBeforeTaxes = grossIncome - totalCosts;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('EXPENSES ' + filterValue);

    // Header structure based on the accountant's template
    sheet.getCell('A1').value = sheetTitle;
    sheet.getCell('A1').font = { bold: true };
    
    sheet.getCell('G1').value = 'Income Before Personal Taxes';
    sheet.getCell('G1').font = { bold: true };
    sheet.getCell('I1').value = 'Total Costs =';
    sheet.getCell('I1').font = { bold: true };
    sheet.getCell('J1').value = totalCosts;
    sheet.getCell('J1').numFmt = '0.00';

    sheet.getCell('D2').value = 'Total Paid';
    sheet.getCell('D2').font = { bold: true };
    sheet.getCell('E2').value = 'Sub Total Owed';
    sheet.getCell('E2').font = { bold: true };
    sheet.getCell('F2').value = 'Sales Tax Owed';
    sheet.getCell('F2').font = { bold: true };
    sheet.getCell('G2').value = incomeBeforeTaxes;
    sheet.getCell('G2').numFmt = '0.00';
    sheet.getCell('I2').value = 'Gross Income=';
    sheet.getCell('I2').font = { bold: true };
    sheet.getCell('J2').value = grossIncome;
    sheet.getCell('J2').numFmt = '0.00';

    sheet.getCell('D3').value = totalTaxPaid;
    sheet.getCell('D3').numFmt = '0.00';
    sheet.getCell('E3').value = subTotalOwed;
    sheet.getCell('E3').numFmt = '0.00';
    sheet.getCell('F3').value = totalTaxOwed;
    sheet.getCell('F3').numFmt = '0.00';

    // Row 4 Headers
    sheet.getRow(4).values = [
      'DATE', 'COST', 'INCOME', 'SALES TAX PAID', 'SALES TAX OWED', 'Pay To:', 'Invoice #', 'Location', 'ITEM(S)', 'NOTES:'
    ];
    sheet.getRow(4).font = { bold: true };

    // Fill data
    rows.forEach((r, idx) => {
      const isExpense = r.type === 'Expense';
      sheet.addRow([
        r.date,
        isExpense ? r.amount : '',
        !isExpense ? r.amount : '',
        isExpense ? (r.sales_tax_paid || '') : '',
        !isExpense ? (r.sales_tax_owed || '') : '',
        r.vendor,
        r.invoice_number || '',
        r.location || '',
        r.items || '',
        r.notes || ''
      ]);
    });

    // Formatting columns
    sheet.columns.forEach(col => { col.width = 15; });
    sheet.getColumn(6).width = 25; // Pay To
    sheet.getColumn(9).width = 30; // Items
    sheet.getColumn(10).width = 30; // Notes

    const buffer = await workbook.xlsx.writeBuffer();
    
    res.setHeader('Content-Disposition', `attachment; filename="RackettyBoom_Accountant_${filterValue}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Request error.' });
  }
  return res.status(500).json({ error: 'Unknown server error.' });
});

(async () => {
  try {
    await ensureSchema();
    app.listen(PORT, () => {
      console.log(`Greg Tracker backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize backend:', error);
    process.exit(1);
  }
})();
