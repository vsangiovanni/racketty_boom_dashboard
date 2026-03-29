const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const multer = require('multer');
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const ExcelImportService = require('./services/excelImportService');

const productionEnvPath = path.resolve(__dirname, '.env.production');
const defaultEnvPath = path.resolve(__dirname, '.env');
const selectedEnvPath = fs.existsSync(productionEnvPath) ? productionEnvPath : defaultEnvPath;
dotenv.config({ path: selectedEnvPath });

const app = express();
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const UPLOAD_FS_DIR = process.env.UPLOAD_FS_DIR
  ? (path.isAbsolute(process.env.UPLOAD_FS_DIR)
      ? process.env.UPLOAD_FS_DIR
      : path.resolve(process.cwd(), process.env.UPLOAD_FS_DIR))
  : path.join(__dirname, '..', UPLOAD_DIR);
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
  namedPlaceholders: true,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
});

let effectiveUploadDir = UPLOAD_FS_DIR;
try {
  fs.mkdirSync(effectiveUploadDir, { recursive: true });
} catch (err) {
  const fallback = path.join(require('os').tmpdir(), 'greg-tracker-uploads');
  console.warn('Upload dir not writable, using tmp:', effectiveUploadDir, err && err.message);
  try {
    fs.mkdirSync(fallback, { recursive: true });
    effectiveUploadDir = fallback;
  } catch (err2) {
    console.error('Could not create upload directory:', err2);
    throw err2;
  }
}

app.use(cors());
app.use(express.json());

let appSettings = {
  app_pin: null,
  business_name: 'Racketty Boom Enterprises',
  logo_url: null,
  avatar_url: null
};

async function reloadSettings() {
  try {
    const [rows] = await pool.query('SELECT * FROM settings LIMIT 1');
    if (rows.length) {
      if (rows[0].app_pin) appSettings.app_pin = rows[0].app_pin;
      if (rows[0].business_name) appSettings.business_name = rows[0].business_name;
      appSettings.logo_url = rows[0].logo_url || null;
      appSettings.avatar_url = rows[0].avatar_url || null;
    }
  } catch(e) {}
}

function parseCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    if (k !== name) continue;
    try {
      return decodeURIComponent(p.slice(idx + 1).trim());
    } catch (_e) {
      return p.slice(idx + 1).trim();
    }
  }
  return null;
}

function hashUserPin(pin) {
  const pepper = process.env.APP_USER_PIN_PEPPER || 'greg-tracker-user-pin-pepper';
  return crypto.createHash('sha256').update(pepper + '\0' + String(pin)).digest('hex');
}

async function countActiveAppUsers() {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM app_users WHERE is_active = 1');
    return Number(rows[0]?.n || 0);
  } catch (_e) {
    return 0;
  }
}

app.get('/api/auth/options', async (_req, res) => {
  try {
    await reloadSettings();
    const n = await countActiveAppUsers();
    if (n === 0) {
      return res.json({ multiUser: false, users: [] });
    }
    const [rows] = await pool.query(
      'SELECT id, display_name, role FROM app_users WHERE is_active = 1 ORDER BY display_name ASC'
    );
    return res.json({ multiUser: true, users: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth', async (req, res) => {
  try {
    await reloadSettings();
    const n = await countActiveAppUsers();
    const { pin, user_id: userIdRaw } = req.body || {};

    if (n > 0) {
      const userId = Number(userIdRaw);
      if (!userId || !pin) {
        return res.status(400).json({ error: 'Select a user and enter an access code.' });
      }
      const [rows] = await pool.query(
        'SELECT id, pin_hash, is_active FROM app_users WHERE id = :id LIMIT 1',
        { id: userId }
      );
      if (!rows.length || !rows[0].is_active || hashUserPin(String(pin)) !== rows[0].pin_hash) {
        return res.status(401).json({ error: 'Invalid user or access code.' });
      }
      res.clearCookie('auth_pin', { path: '/' });
      res.cookie('gt_uid', String(rows[0].id), { httpOnly: true, path: '/', sameSite: 'lax' });
      res.cookie('gt_pin', String(pin), { httpOnly: true, path: '/', sameSite: 'lax' });
      return res.json({ success: true });
    }

    if (!appSettings.app_pin) {
      return res.status(401).json({ error: 'Access code not configured.' });
    }
    if (pin === appSettings.app_pin) {
      res.clearCookie('gt_uid', { path: '/' });
      res.clearCookie('gt_pin', { path: '/' });
      res.cookie('auth_pin', pin, { httpOnly: true, path: '/', sameSite: 'lax' });
      return res.json({ success: true });
    }
    return res.status(401).json({ error: 'Invalid access code.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_pin', { path: '/' });
  res.clearCookie('gt_uid', { path: '/' });
  res.clearCookie('gt_pin', { path: '/' });
  return res.json({ success: true });
});

app.use(async (req, res, next) => {
  if (
    req.path === '/' ||
    req.path === '/index.html' ||
    req.path === '/quote.html' ||
    req.path === '/service.html' ||
    req.path === '/login.html' ||
    req.path === '/help.html' ||
    req.path.startsWith('/js/') ||
    req.path.startsWith('/assets/') ||
    req.path.startsWith('/data/') ||
    req.path.startsWith('/service-') ||
    (req.path === '/api/quote-requests' && req.method === 'POST') ||
    req.path === '/api/auth' ||
    req.path === '/api/auth/options' ||
    req.path.startsWith('/icon.svg') ||
    req.path.startsWith(`/${UPLOAD_DIR}/`) ||
    req.path === '/api/settings/public'
  ) {
    return next();
  }

  req.actorUserId = null;
  req.actorName = null;
  req.actorRole = null;

  const gtUid = parseCookie(req, 'gt_uid');
  const gtPin = parseCookie(req, 'gt_pin');
  if (gtUid && gtPin) {
    try {
      const uid = Number(gtUid);
      if (uid) {
        const [rows] = await pool.query(
          'SELECT id, display_name, role, pin_hash, is_active FROM app_users WHERE id = ? LIMIT 1',
          [uid]
        );
        if (rows.length && rows[0].is_active && hashUserPin(gtPin) === rows[0].pin_hash) {
          req.actorUserId = rows[0].id;
          req.actorName = rows[0].display_name;
          req.actorRole = rows[0].role;
          return next();
        }
      }
    } catch (_e) {}
  }

  const pin = parseCookie(req, 'auth_pin');
  if (pin && appSettings.app_pin && pin === appSettings.app_pin) {
    try {
      const activeUsers = await countActiveAppUsers();
      if (activeUsers === 0) {
        req.actorRole = 'Admin';
        return next();
      }
    } catch (_e) {}
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.redirect('/login.html');
});

// Public service pages (mirror official /service-* routes locally).
app.get(/^\/service-/, (_req, res) => {
  return res.sendFile(path.join(__dirname, '../frontend/service.html'));
});

app.use(express.static(path.join(__dirname, '../frontend')));
app.use(`/${UPLOAD_DIR}`, express.static(effectiveUploadDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, effectiveUploadDir);
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

function getUserRole(req) {
  if (req.actorRole === 'Viewer' || req.actorRole === 'Manager' || req.actorRole === 'Admin') {
    return req.actorRole;
  }
  const raw = String(req.headers['x-user-role'] || '').trim().toLowerCase();
  if (raw === 'viewer') return 'Viewer';
  if (raw === 'manager') return 'Manager';
  return 'Admin';
}

function ensureAdmin(req, res) {
  if (getUserRole(req) !== 'Admin') {
    res.status(403).json({ error: 'Admin role required.' });
    return false;
  }
  return true;
}

function ensureCanEdit(req, res) {
  const role = getUserRole(req);
  if (role === 'Viewer') {
    res.status(403).json({ error: 'Viewer role is read-only.' });
    return false;
  }
  return true;
}

async function getApprovalThreshold(connection) {
  const [rows] = await connection.query('SELECT approval_threshold FROM settings LIMIT 1');
  const value = Number(rows?.[0]?.approval_threshold || 0);
  return Number.isFinite(value) && value > 0 ? value : 5000;
}

async function logAudit(connection, req, action, entity, entityId, details) {
  const role = getUserRole(req);
  const payload = details ? JSON.stringify(details) : null;
  await connection.query(
    `
    INSERT INTO audit_logs (action, entity, entity_id, actor_role, actor_ip, details_json)
    VALUES (:action, :entity, :entityId, :role, :ip, :details)
    `,
    {
      action,
      entity,
      entityId: entityId ? String(entityId) : null,
      role,
      ip: req.ip || null,
      details: payload
    }
  );
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

async function generateProjectInsightsWithOpenAI(projectContext) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing.');

  const model = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
  const prompt = [
    'You are a senior financial operations analyst.',
    'Analyze the following project finance context and return practical business insights.',
    'Return STRICT JSON only (no markdown, no commentary) with this exact shape:',
    '{"summary":"string","insights":["string"],"recommendations":["string"]}',
    'Rules:',
    '- English only',
    '- summary max 200 chars',
    '- insights: 3 to 5 bullet-style sentences',
    '- recommendations: 3 to 5 clear, actionable sentences',
    '- Keep tone concise and professional',
    '',
    'PROJECT_CONTEXT_JSON:',
    JSON.stringify(projectContext)
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${JSON.stringify(data)}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response did not include message content.');
  return parseStrictJson(content);
}

async function generateProjectInsightsWithGemini(projectContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing.');

  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.0-flash';
  const prompt = [
    'You are a senior financial operations analyst.',
    'Analyze this project finance context and produce concise, actionable insights.',
    'Output STRICT JSON only with exact keys:',
    '{"summary":"string","insights":["string"],"recommendations":["string"]}',
    'Rules:',
    '- English only',
    '- summary max 200 chars',
    '- insights: 3 to 5 items',
    '- recommendations: 3 to 5 items',
    '',
    'PROJECT_CONTEXT_JSON:',
    JSON.stringify(projectContext)
  ].join('\n');

  const url = `https://generativelanguage.googleapis.com/v1alpha/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
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
  return parseStrictJson(content);
}

async function generateProjectInsightsWithAI(projectContext) {
  const provider = (process.env.VISION_PROVIDER || 'openai').toLowerCase();
  const canUseOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const canUseGemini = Boolean(process.env.GEMINI_API_KEY);

  if (provider === 'gemini') {
    try {
      return await generateProjectInsightsWithGemini(projectContext);
    } catch (err) {
      if (canUseOpenAI) {
        return generateProjectInsightsWithOpenAI(projectContext);
      }
      throw err;
    }
  }

  try {
    return await generateProjectInsightsWithOpenAI(projectContext);
  } catch (err) {
    if (canUseGemini) {
      return generateProjectInsightsWithGemini(projectContext);
    }
    throw err;
  }
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

/**
 * WHERE fragments for ledger queries. When applyUserFilters is false, only company/project scope (for filter-option lists).
 */
function buildLedgerWhereClause(query, { companyFieldExists, projectId, applyUserFilters }) {
  const conditions = [];
  const params = {};

  if (companyFieldExists) {
    conditions.push('t.company = :company');
    params.company = DEFAULT_COMPANY_NAME;
  }
  if (projectId != null) {
    const pid = Number(projectId);
    if (Number.isFinite(pid) && pid > 0) {
      conditions.push('t.project_id = :projectId');
      params.projectId = pid;
    }
  }

  if (applyUserFilters) {
    const q = query || {};
    const dateFrom = String(q.dateFrom || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      conditions.push('t.transaction_date >= :dateFrom');
      params.dateFrom = dateFrom;
    }
    const dateTo = String(q.dateTo || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      conditions.push('t.transaction_date <= :dateTo');
      params.dateTo = dateTo;
    }
    const vendor = String(q.vendor || '').trim();
    if (vendor) {
      conditions.push('TRIM(t.vendor) = :vendor');
      params.vendor = vendor;
    }
    const category = String(q.category || '').trim();
    if (category) {
      conditions.push(`COALESCE(NULLIF(TRIM(c.name), ''), 'General') = :category`);
      params.category = category;
    }
    const type = String(q.type || 'all').trim();
    if (type === 'Income' || type === 'Expense') {
      conditions.push('t.type = :txType');
      params.txType = type;
    }
    const amountMin = q.amountMin;
    if (amountMin !== undefined && amountMin !== null && String(amountMin).trim() !== '') {
      const n = Number(amountMin);
      if (Number.isFinite(n)) {
        conditions.push('ABS(t.amount) >= :amountMin');
        params.amountMin = n;
      }
    }
    const amountMax = q.amountMax;
    if (amountMax !== undefined && amountMax !== null && String(amountMax).trim() !== '') {
      const n = Number(amountMax);
      if (Number.isFinite(n)) {
        conditions.push('ABS(t.amount) <= :amountMax');
        params.amountMax = n;
      }
    }
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, params };
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
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_quote_status (status),
      INDEX idx_quote_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      receipt_id BIGINT UNSIGNED NULL,
      category_id BIGINT UNSIGNED NULL,
      project_id BIGINT UNSIGNED NULL,
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
      KEY idx_transactions_project_id (project_id),
      CONSTRAINT fk_transactions_receipt FOREIGN KEY (receipt_id) REFERENCES receipt_uploads(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      CONSTRAINT fk_transactions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
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
        approval_threshold DECIMAL(12,2) DEFAULT 5000.00,
        date_format VARCHAR(20) DEFAULT 'MM/DD/YYYY',
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

    try {
      await pool.query('DROP TABLE IF EXISTS project_invoices');
    } catch (_e) {}

    try {
      await pool.query('DROP TABLE IF EXISTS project_execution_updates');
    } catch (_e) {}

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

app.get('/api/session/me', async (req, res) => {
  try {
    if (req.actorUserId) {
      return res.json({
        mode: 'user',
        user_id: req.actorUserId,
        display_name: req.actorName,
        role: req.actorRole
      });
    }
    return res.json({ mode: 'legacy', role: req.actorRole || 'Admin' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  try {
    const [rows] = await pool.query(
      'SELECT id, display_name, role, is_active, created_at FROM app_users ORDER BY display_name ASC'
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;
  if (!ensureAdmin(req, res)) return;
  try {
    const { display_name: displayName, role: roleRaw, user_pin: userPin } = req.body || {};
    const name = String(displayName || '').trim();
    const pin = String(userPin || '').trim();
    if (!name || !pin) {
      return res.status(400).json({ error: 'display_name and user_pin are required.' });
    }
    let r = String(roleRaw || 'Manager').trim();
    if (r !== 'Admin' && r !== 'Manager' && r !== 'Viewer') r = 'Manager';
    await pool.query(
      'INSERT INTO app_users (display_name, role, pin_hash) VALUES (:name, :role, :pinHash)',
      { name, role: r, pinHash: hashUserPin(pin) }
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;
  if (!ensureAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id.' });
    const { display_name: displayName, role: roleRaw, user_pin: userPin, is_active: isActiveRaw } = req.body || {};

    const [existing] = await pool.query('SELECT id, role, is_active FROM app_users WHERE id = ? LIMIT 1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'User not found.' });

    const updates = [];
    const params = { id };

    if (displayName !== undefined) {
      const name = String(displayName || '').trim();
      if (!name) return res.status(400).json({ error: 'display_name cannot be empty.' });
      updates.push('display_name = :dname');
      params.dname = name;
    }
    if (roleRaw !== undefined) {
      let r = String(roleRaw || '').trim();
      if (r !== 'Admin' && r !== 'Manager' && r !== 'Viewer') {
        return res.status(400).json({ error: 'Invalid role.' });
      }
      if (existing[0].role === 'Admin' && r !== 'Admin') {
        const [admins] = await pool.query(
          "SELECT COUNT(*) AS n FROM app_users WHERE is_active = 1 AND role = 'Admin' AND id <> ?",
          [id]
        );
        if (admins[0].n < 1) {
          return res.status(400).json({ error: 'Promote another Admin before changing this user\'s role.' });
        }
      }
      updates.push('role = :role');
      params.role = r;
    }
    if (userPin !== undefined) {
      const pin = String(userPin || '').trim();
      if (!pin) return res.status(400).json({ error: 'user_pin cannot be empty.' });
      updates.push('pin_hash = :pinHash');
      params.pinHash = hashUserPin(pin);
    }
    if (isActiveRaw !== undefined) {
      const on = isActiveRaw === true || isActiveRaw === 1 || isActiveRaw === '1';
      if (!on) {
        const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM app_users WHERE is_active = 1');
        if (Number(cnt[0].n) <= 1 && existing[0].is_active) {
          return res.status(400).json({ error: 'Cannot deactivate the last active user.' });
        }
        if (existing[0].role === 'Admin' && existing[0].is_active) {
          const [admins] = await pool.query(
            "SELECT COUNT(*) AS n FROM app_users WHERE is_active = 1 AND role = 'Admin' AND id <> ?",
            [id]
          );
          if (admins[0].n < 1) {
            return res.status(400).json({ error: 'Assign another Admin before deactivating this one.' });
          }
        }
      }
      updates.push('is_active = :active');
      params.active = on ? 1 : 0;
    }

    if (!updates.length) return res.status(400).json({ error: 'No changes provided.' });
    await pool.query(`UPDATE app_users SET ${updates.join(', ')} WHERE id = :id`, params);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;
  if (!ensureAdmin(req, res)) return;
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id.' });
    const [row] = await pool.query('SELECT role, is_active FROM app_users WHERE id = ?', [id]);
    if (!row.length) return res.status(404).json({ error: 'User not found.' });
    if (row[0].is_active) {
      const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM app_users WHERE is_active = 1');
      if (Number(cnt[0].n) <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last active user.' });
      }
      if (row[0].role === 'Admin') {
        const [admins] = await pool.query(
          "SELECT COUNT(*) AS n FROM app_users WHERE is_active = 1 AND role = 'Admin' AND id <> ?",
          [id]
        );
        if (admins[0].n < 1) {
          return res.status(400).json({ error: 'Assign another Admin before deleting this user.' });
        }
      }
    }
    await pool.query('DELETE FROM app_users WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM projects ORDER BY status ASC, name ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, status } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    await pool.query('INSERT INTO projects (name, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status=?', [name, status || 'Active', status || 'Active']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { name, status } = req.body;
    await pool.query('UPDATE projects SET name=?, status=? WHERE id=?', [name, status, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * Project statistics + recent transactions for the project details modal.
 */
app.get('/api/projects/:id/stats', async (req, res) => {
  try {
    const projectId = req.params.id;

    const projectQuery = 'SELECT * FROM projects WHERE id = ?';
    const [projectRows] = await pool.query(projectQuery, [projectId]);

    if (projectRows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = projectRows[0];

    const statsQuery = `
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS totalExpenses,
        COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS totalIncome,
        COUNT(*) AS transactionCount
      FROM transactions t
      WHERE t.project_id = ?
    `;

    const [statsRows] = await pool.query(statsQuery, [projectId]);
    const stats = statsRows[0];

    const totalExpenses = parseFloat(stats.totalExpenses) || 0;
    const totalIncome = parseFloat(stats.totalIncome) || 0;
    const netProfit = totalIncome - totalExpenses;
    const margin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(2) : 0;

    return res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.created_at,
        updatedAt: project.updated_at
      },
      metrics: {
        totalExpenses,
        totalIncome,
        netProfit,
        margin: parseFloat(margin),
        transactionCount: stats.transactionCount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/transactions/filter-options', async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  const connection = await pool.getConnection();
  try {
    const companyFieldExists = await hasTransactionsCompanyColumn(connection);
    const { whereSql, params } = buildLedgerWhereClause({}, {
      companyFieldExists,
      projectId,
      applyUserFilters: false
    });
    const vendorTail = whereSql
      ? `${whereSql} AND t.vendor IS NOT NULL AND TRIM(t.vendor) <> ''`
      : `WHERE t.vendor IS NOT NULL AND TRIM(t.vendor) <> ''`;
    const [vRows] = await connection.query(
      `SELECT DISTINCT TRIM(t.vendor) AS v FROM transactions t ${vendorTail} ORDER BY v ASC`,
      params
    );
    const catTail = whereSql || 'WHERE 1=1';
    const [cRows] = await connection.query(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(c.name), ''), 'General') AS cat
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       ${catTail}
       ORDER BY cat ASC`,
      params
    );
    return res.json({
      vendors: vRows.map((r) => r.v).filter(Boolean),
      categories: cRows.map((r) => r.cat).filter(Boolean)
    });
  } catch (err) {
    console.error('Project transaction filter-options error:', err);
    return res.status(500).json({ error: 'Failed to load filter options' });
  } finally {
    connection.release();
  }
});

app.get('/api/projects/:id/transactions', async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Invalid project id' });
  }
  const connection = await pool.getConnection();
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);

    const companyFieldExists = await hasTransactionsCompanyColumn(connection);
    const { whereSql, params } = buildLedgerWhereClause(req.query, {
      companyFieldExists,
      projectId,
      applyUserFilters: true
    });

    const countSql = `
      SELECT COUNT(*) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ${whereSql || ''}
    `;
    const [[{ total }]] = await connection.query(countSql, params);

    const totalNum = Number(total) || 0;
    const totalPages = totalNum === 0 ? 1 : Math.ceil(totalNum / limit);
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * limit;
    const listParams = { ...params, limit, offset };

    const [rows] = await connection.query(
      `
      SELECT
        t.id,
        t.vendor,
        t.transaction_date AS date,
        t.amount,
        t.type,
        t.notes,
        c.name AS category,
        ru.storage_url AS receipt_url
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN receipt_uploads ru ON ru.id = t.receipt_id
      ${whereSql || ''}
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT :limit OFFSET :offset
      `,
      listParams
    );

    return res.json({
      transactions: rows,
      pagination: {
        total: totalNum,
        page: effectivePage,
        limit,
        totalPages
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.get('/api/projects/:id/breakdown', async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return res.status(400).json({ error: 'Invalid project id' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit || 6), 1), 25);

    // MariaDB: no usar alias de agregados en WHERE exterior (error "Reference 'income' not supported").
    // HAVING / ORDER BY con las mismas expresiones SUM que en SELECT.
    const sumIncome = 'COALESCE(SUM(CASE WHEN t.type = \'Income\' THEN t.amount ELSE 0 END), 0)';
    const sumExpense = 'COALESCE(SUM(CASE WHEN t.type = \'Expense\' THEN t.amount ELSE 0 END), 0)';

    const [cats] = await pool.query(
      `
      SELECT
        COALESCE(c.name, 'General') AS category,
        ${sumIncome} AS income,
        ${sumExpense} AS expenses
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.project_id = ?
      GROUP BY COALESCE(c.name, 'General')
      HAVING (${sumIncome}) <> 0 OR (${sumExpense}) <> 0
      ORDER BY (${sumIncome} + ${sumExpense}) DESC
      LIMIT ?
      `,
      [projectId, limit]
    );

    const [vendors] = await pool.query(
      `
      SELECT
        t.vendor AS vendor,
        ${sumIncome} AS income,
        ${sumExpense} AS expenses
      FROM transactions t
      WHERE t.project_id = ?
      GROUP BY t.vendor
      HAVING (${sumIncome}) <> 0 OR (${sumExpense}) <> 0
      ORDER BY (${sumIncome} + ${sumExpense}) DESC
      LIMIT ?
      `,
      [projectId, limit]
    );

    return res.json({ categories: cats, vendors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/budget-summary', async (req, res) => {
  try {
    const projectId = req.params.id;
    const [budgetRows] = await pool.query(
      `
      SELECT total_budget, committed_cost, warning_percent, overrun_percent
      FROM project_budgets
      WHERE project_id = :projectId
      LIMIT 1
      `,
      { projectId }
    );
    const budget = budgetRows[0] || { total_budget: 0, committed_cost: 0, warning_percent: 80, overrun_percent: 100 };

    const [actualRows] = await pool.query(
      `
      SELECT COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS actual_expense
      FROM transactions
      WHERE project_id = :projectId
      `,
      { projectId }
    );
    const actualExpense = Number(actualRows?.[0]?.actual_expense || 0);
    const totalBudget = Number(budget.total_budget || 0);
    const committedCost = Number(budget.committed_cost || 0);
    const projectedFinalCost = actualExpense + committedCost;
    const consumedPct = totalBudget > 0 ? (actualExpense / totalBudget) * 100 : 0;
    const warningPct = Number(budget.warning_percent || 80);
    const overrunPct = Number(budget.overrun_percent || 100);
    const status = consumedPct >= overrunPct ? 'Overrun' : consumedPct >= warningPct ? 'Warning' : 'OK';

    const [categoryBudgetRows] = await pool.query(
      `
      SELECT
        b.category_name,
        b.budget_amount,
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS actual_amount
      FROM project_budget_categories b
      LEFT JOIN categories c ON c.name = b.category_name
      LEFT JOIN transactions t ON t.project_id = b.project_id AND t.category_id = c.id
      WHERE b.project_id = :projectId
      GROUP BY b.id, b.category_name, b.budget_amount
      ORDER BY b.category_name ASC
      `,
      { projectId }
    );

    return res.json({
      budget: {
        total_budget: totalBudget,
        committed_cost: committedCost,
        actual_expense: actualExpense,
        projected_final_cost: projectedFinalCost,
        consumed_percent: Number(consumedPct.toFixed(2)),
        warning_percent: warningPct,
        overrun_percent: overrunPct,
        status
      },
      categories: categoryBudgetRows.map((r) => {
        const b = Number(r.budget_amount || 0);
        const a = Number(r.actual_amount || 0);
        const pct = b > 0 ? (a / b) * 100 : 0;
        return {
          category_name: r.category_name,
          budget_amount: b,
          actual_amount: a,
          consumed_percent: Number(pct.toFixed(2))
        };
      })
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/budget', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;
  const connection = await pool.getConnection();
  try {
    const projectId = req.params.id;
    const totalBudget = Number(req.body.total_budget || 0);
    const committedCost = Number(req.body.committed_cost || 0);
    const warningPercent = Number(req.body.warning_percent || 80);
    const overrunPercent = Number(req.body.overrun_percent || 100);
    const categories = Array.isArray(req.body.categories) ? req.body.categories : [];

    await connection.beginTransaction();
    await connection.query(
      `
      INSERT INTO project_budgets (project_id, total_budget, committed_cost, warning_percent, overrun_percent)
      VALUES (:projectId, :totalBudget, :committedCost, :warningPercent, :overrunPercent)
      ON DUPLICATE KEY UPDATE
        total_budget = VALUES(total_budget),
        committed_cost = VALUES(committed_cost),
        warning_percent = VALUES(warning_percent),
        overrun_percent = VALUES(overrun_percent)
      `,
      { projectId, totalBudget, committedCost, warningPercent, overrunPercent }
    );

    await connection.query('DELETE FROM project_budget_categories WHERE project_id = :projectId', { projectId });
    for (const row of categories) {
      const categoryName = String(row.category_name || '').trim();
      const budgetAmount = Number(row.budget_amount || 0);
      if (!categoryName) continue;
      await connection.query(
        `
        INSERT INTO project_budget_categories (project_id, category_name, budget_amount)
        VALUES (:projectId, :categoryName, :budgetAmount)
        `,
        { projectId, categoryName, budgetAmount }
      );
    }

    await logAudit(connection, req, 'UPSERT', 'project_budget', projectId, { totalBudget, committedCost, categories: categories.length });
    await connection.commit();
    return res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

/**
 * Financial activity derived from ledger transactions for this project.
 * Not physical job-site progress; see project-details UI disclaimer.
 */
app.get('/api/projects/:id/ledger-signals', async (req, res) => {
  try {
    const projectId = req.params.id;

    const [aggRows] = await pool.query(
      `
      SELECT
        COUNT(*) AS transaction_count,
        COALESCE(SUM(CASE WHEN type = 'Expense' THEN 1 ELSE 0 END), 0) AS expense_count,
        COALESCE(SUM(CASE WHEN type = 'Income' THEN 1 ELSE 0 END), 0) AS income_count,
        COALESCE(SUM(CASE WHEN type = 'Expense' THEN amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END), 0) AS total_income,
        MIN(transaction_date) AS first_date,
        MAX(transaction_date) AS last_date,
        CASE
          WHEN MIN(transaction_date) IS NULL THEN 0
          ELSE DATEDIFF(MAX(transaction_date), MIN(transaction_date)) + 1
        END AS activity_span_days
      FROM transactions
      WHERE project_id = :projectId
      `,
      { projectId }
    );

    const r = aggRows[0] || {};
    const spanDays = Math.max(1, Number(r.activity_span_days || 0) || 1);
    const weeks = spanDays / 7;
    const totalExp = Number(r.total_expense || 0);
    const totalInc = Number(r.total_income || 0);
    const avgWeeklyExpense = weeks > 0 ? totalExp / weeks : totalExp;
    const avgWeeklyIncome = weeks > 0 ? totalInc / weeks : totalInc;
    let incomeToExpenseRatio = null;
    if (totalExp > 0) incomeToExpenseRatio = Number((totalInc / totalExp).toFixed(2));
    else if (totalInc > 0) incomeToExpenseRatio = null;

    const [budRows] = await pool.query(
      'SELECT total_budget FROM project_budgets WHERE project_id = :projectId LIMIT 1',
      { projectId }
    );
    const totalBudget = Number(budRows[0]?.total_budget || 0);
    const budgetConsumedPercent =
      totalBudget > 0 ? Number(((totalExp / totalBudget) * 100).toFixed(2)) : null;

    return res.json({
      transaction_count: Number(r.transaction_count || 0),
      expense_count: Number(r.expense_count || 0),
      income_count: Number(r.income_count || 0),
      total_expense: totalExp,
      total_income: totalInc,
      first_date: r.first_date,
      last_date: r.last_date,
      activity_span_days: Number(r.activity_span_days || 0),
      avg_weekly_expense: Number(avgWeeklyExpense.toFixed(2)),
      avg_weekly_income: Number(avgWeeklyIncome.toFixed(2)),
      income_to_expense_ratio: incomeToExpenseRatio,
      budget_consumed_percent: budgetConsumedPercent
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const [rows] = await pool.query(
      `
      SELECT id, action, entity, entity_id, actor_role, actor_ip, details_json, created_at
      FROM audit_logs
      ORDER BY id DESC
      LIMIT :limit
      `,
      { limit }
    );
    return res.json({ logs: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/ai-insights', async (req, res) => {
  try {
    const projectId = req.params.id;

    const [projectRows] = await pool.query(
      'SELECT id, name, status, created_at, updated_at FROM projects WHERE id = ? LIMIT 1',
      [projectId]
    );
    if (!projectRows.length) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = projectRows[0];

    const [metricRows] = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS totalExpenses,
        COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS totalIncome,
        COUNT(*) AS transactionCount
      FROM transactions t
      WHERE t.project_id = ?
      `,
      [projectId]
    );
    const metric = metricRows[0] || {};
    const totalExpenses = Number(metric.totalExpenses || 0);
    const totalIncome = Number(metric.totalIncome || 0);
    const netProfit = totalIncome - totalExpenses;
    const margin = totalIncome > 0 ? Number(((netProfit / totalIncome) * 100).toFixed(2)) : 0;

    const [categories] = await pool.query(
      `
      SELECT
        COALESCE(c.name, 'General') AS category,
        COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS expenses
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.project_id = ?
      GROUP BY COALESCE(c.name, 'General')
      HAVING income <> 0 OR expenses <> 0
      ORDER BY (income + expenses) DESC
      LIMIT 5
      `,
      [projectId]
    );

    const [vendors] = await pool.query(
      `
      SELECT
        t.vendor AS vendor,
        COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS expenses
      FROM transactions t
      WHERE t.project_id = ?
      GROUP BY t.vendor
      HAVING income <> 0 OR expenses <> 0
      ORDER BY (income + expenses) DESC
      LIMIT 5
      `,
      [projectId]
    );

    const [transactions] = await pool.query(
      `
      SELECT
        t.transaction_date AS date,
        t.vendor,
        COALESCE(c.name, 'General') AS category,
        t.type,
        t.amount
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.project_id = ?
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT 12
      `,
      [projectId]
    );

    const projectContext = {
      project: {
        id: project.id,
        name: project.name,
        status: project.status
      },
      metrics: {
        transactionCount: Number(metric.transactionCount || 0),
        totalIncome,
        totalExpenses,
        netProfit,
        margin
      },
      topCategories: categories,
      topVendors: vendors,
      recentTransactions: transactions
    };

    const ai = await generateProjectInsightsWithAI(projectContext);
    const insights = Array.isArray(ai?.insights) ? ai.insights.map(x => String(x).trim()).filter(Boolean) : [];
    const recommendations = Array.isArray(ai?.recommendations) ? ai.recommendations.map(x => String(x).trim()).filter(Boolean) : [];
    const summary = String(ai?.summary || '').trim();

    return res.json({
      source: 'ai',
      summary,
      insights,
      recommendations
    });
  } catch (err) {
    const msg = String(err?.message || '');
    const missingKey = msg.includes('OPENAI_API_KEY is missing') || msg.includes('GEMINI_API_KEY is missing');
    if (missingKey) {
      return res.status(503).json({ error: 'AI provider not configured. Set API key to enable AI insights.' });
    }
    return res.status(500).json({ error: err.message });
  }
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
    const { receiptId, vendor, date, invoice_number, items, subtotal, sales_tax_paid, sales_tax_owed, total, category_id, category_name, type, notes, payment_method, location, project_id: projectIdRaw } = req.body;

    const normalizedType = normalizeType(type);
    const normalizedAmount = Number(total);

    let projectId = null;
    if (projectIdRaw !== undefined && projectIdRaw !== null && projectIdRaw !== '') {
      const n = Number(projectIdRaw);
      projectId = Number.isFinite(n) ? n : null;
    }

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
      INSERT INTO transactions (receipt_id, category_id, project_id, vendor, invoice_number, items, transaction_date, subtotal, sales_tax_paid, sales_tax_owed, amount, type, payment_method, location, notes)
      VALUES (:receiptId, :categoryId, :projectId, :vendor, :invoice_number, :items, :transactionDate, :subtotal, :sales_tax_paid, :sales_tax_owed, :amount, :type, :payment_method, :location, :notes)
      `,
      {
        receiptId,
        categoryId: finalCategoryId || null,
        projectId,
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
  if (!ensureCanEdit(req, res)) return;
  const connection = await pool.getConnection();
  try {
    const { type, vendor, date, invoice_number, items, subtotal, sales_tax_paid, sales_tax_owed, total, category_id, category_name, payment_method, location, notes, project_id: projectIdRaw } = req.body;
    if (!type || !vendor || !date || total === undefined) {
      return res.status(400).json({ error: 'Missing required fields: type, vendor, date, total' });
    }
    
    let projectId = null;
    if (projectIdRaw !== undefined && projectIdRaw !== null && projectIdRaw !== '') {
      const n = Number(projectIdRaw);
      projectId = Number.isFinite(n) ? n : null;
    }

    await connection.beginTransaction();
    
    let finalCategoryId = category_id;
    if (!finalCategoryId && category_name) {
      await connection.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', { name: category_name });
      const [catRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      finalCategoryId = catRows[0].id;
    }

    const amountNumber = Number(total || 0);
    const normalizedType = normalizeType(type) || type;
    const approvalThreshold = await getApprovalThreshold(connection);
    const reviewStatus = normalizedType === 'Expense' && amountNumber >= approvalThreshold ? 'pending_approval' : 'approved';

    const [txResult] = await connection.query(
      `INSERT INTO transactions 
       (category_id, project_id, vendor, invoice_number, items, transaction_date, subtotal, sales_tax_paid, sales_tax_owed, amount, type, payment_method, location, notes, extraction_status, review_status)
       VALUES (:categoryId, :projectId, :vendor, :invoice_number, :items, :date, :subtotal, :sales_tax_paid, :sales_tax_owed, :amount, :type, :payment_method, :location, :notes, 'manual', :reviewStatus)`,
      { 
        categoryId: finalCategoryId || null, projectId, vendor, invoice_number: invoice_number || null, items: items || null, date, 
        subtotal: subtotal || 0, sales_tax_paid: sales_tax_paid || 0, sales_tax_owed: sales_tax_owed || 0, amount: total || 0, type, 
        payment_method: payment_method || null, location: location || null, notes: notes || null, reviewStatus
      }
    );
    await logAudit(connection, req, 'CREATE', 'transaction', txResult.insertId, { projectId, type: normalizedType, amount: amountNumber, reviewStatus });
    
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

app.get('/api/transactions/filter-options', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const companyFieldExists = await hasTransactionsCompanyColumn(connection);
    const { whereSql, params } = buildLedgerWhereClause({}, {
      companyFieldExists,
      projectId: null,
      applyUserFilters: false
    });
    const vendorTail = whereSql
      ? `${whereSql} AND t.vendor IS NOT NULL AND TRIM(t.vendor) <> ''`
      : `WHERE t.vendor IS NOT NULL AND TRIM(t.vendor) <> ''`;
    const [vRows] = await connection.query(
      `SELECT DISTINCT TRIM(t.vendor) AS v FROM transactions t ${vendorTail} ORDER BY v ASC`,
      params
    );
    const catTail = whereSql || 'WHERE 1=1';
    const [cRows] = await connection.query(
      `SELECT DISTINCT COALESCE(NULLIF(TRIM(c.name), ''), 'General') AS cat
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       ${catTail}
       ORDER BY cat ASC`,
      params
    );
    return res.json({
      vendors: vRows.map((r) => r.v).filter(Boolean),
      categories: cRows.map((r) => r.cat).filter(Boolean)
    });
  } catch (err) {
    console.error('Transaction filter-options error:', err);
    return res.status(500).json({ error: 'Failed to load filter options' });
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
  if (!ensureCanEdit(req, res)) return;
  const connection = await pool.getConnection();
  try {
    const { type, vendor, date, invoice_number, items, subtotal, sales_tax_paid, sales_tax_owed, total, category_id, category_name, payment_method, location, notes, project_id: projectIdRaw } = req.body;
    if (!type || !vendor || !date || total === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    let projectId = null;
    if (projectIdRaw !== undefined && projectIdRaw !== null && projectIdRaw !== '') {
      const n = Number(projectIdRaw);
      projectId = Number.isFinite(n) ? n : null;
    }

    await connection.beginTransaction();
    
    let finalCategoryId = category_id;
    if (!finalCategoryId && category_name) {
      await connection.query('INSERT INTO categories (name) VALUES (:name) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', { name: category_name });
      const [catRows] = await connection.query('SELECT LAST_INSERT_ID() AS id');
      finalCategoryId = catRows[0].id;
    }

    const amountNumber = Number(total || 0);
    const normalizedType = normalizeType(type) || type;
    const approvalThreshold = await getApprovalThreshold(connection);
    const reviewStatus = normalizedType === 'Expense' && amountNumber >= approvalThreshold ? 'pending_approval' : 'approved';

    await connection.query(
      `UPDATE transactions SET 
        category_id = :categoryId, project_id = :projectId, vendor = :vendor, invoice_number = :invoice_number, items = :items, 
        transaction_date = :date, subtotal = :subtotal, sales_tax_paid = :sales_tax_paid, 
        sales_tax_owed = :sales_tax_owed, amount = :amount, type = :type, 
        payment_method = :payment_method, location = :location, notes = :notes, review_status = :reviewStatus
       WHERE id = :id`,
      { 
        id: req.params.id, categoryId: finalCategoryId || null, projectId, vendor, invoice_number: invoice_number || null, items: items || null, date: date.slice(0, 10), 
        subtotal: subtotal || 0, sales_tax_paid: sales_tax_paid || 0, sales_tax_owed: sales_tax_owed || 0, amount: total || 0, type, 
        payment_method: payment_method || null, location: location || null, notes: notes || null, reviewStatus
      }
    );
    await logAudit(connection, req, 'UPDATE', 'transaction', req.params.id, { projectId, type: normalizedType, amount: amountNumber, reviewStatus });
    
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
  if (!ensureCanEdit(req, res)) return;
  const connection = await pool.getConnection();
  try {
    await connection.query('DELETE FROM transactions WHERE id = :id', { id: req.params.id });
    await logAudit(connection, req, 'DELETE', 'transaction', req.params.id, null);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete record' });
  } finally {
    connection.release();
  }
});

app.get('/api/transactions', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 15), 1), 500);

    const companyFieldExists = await hasTransactionsCompanyColumn(connection);
    const { whereSql, params } = buildLedgerWhereClause(req.query, {
      companyFieldExists,
      projectId: null,
      applyUserFilters: true
    });

    const countSql = `
      SELECT COUNT(*) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      ${whereSql || ''}
    `;
    const [[{ total }]] = await connection.query(countSql, params);

    const totalNum = Number(total) || 0;
    const totalPages = totalNum === 0 ? 1 : Math.ceil(totalNum / limit);
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * limit;
    const listParams = { ...params, limit, offset };

    const [rows] = await connection.query(
      `
      SELECT
        t.id,
        t.vendor,
        t.transaction_date AS date,
        t.amount,
        t.type,
        t.project_id,
        p.name AS project,
        t.notes,
        c.name AS category,
        t.created_at,
        t.review_status,
        ru.storage_url as receipt_url
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN receipt_uploads ru ON ru.id = t.receipt_id
      ${whereSql || ''}
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT :limit OFFSET :offset
      `,
      listParams
    );

    return res.json({
      transactions: rows,
      pagination: {
        total: totalNum,
        page: effectivePage,
        limit,
        totalPages
      }
    });
  } catch (error) {
    console.error('Transactions list error:', error);
    return res.status(500).json({ error: 'Failed to fetch transactions.' });
  } finally {
    connection.release();
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
  try {
    const { filename, rows, project_id: projectIdRaw } = req.body;
    if (!rows || !rows.length) return res.status(400).json({ error: 'No rows to import.' });

    let resolvedProjectId = null;
    if (projectIdRaw !== undefined && projectIdRaw !== null && String(projectIdRaw).trim() !== '') {
      const n = Number(projectIdRaw);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: 'Invalid project_id.' });
      }
      const [prows] = await pool.query('SELECT id FROM projects WHERE id = ? LIMIT 1', [n]);
      if (!prows.length) return res.status(400).json({ error: 'Project not found.' });
      resolvedProjectId = n;
    }

    const connection = await pool.getConnection();
    try {
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
    const approvalThreshold = await getApprovalThreshold(connection);

    for (const row of rows) {
      if (!row.date || !row.vendor) { skipped++; continue; }

      const [dups] = await connection.query(
        `SELECT id FROM transactions
         WHERE vendor = :vendor AND transaction_date = :date AND ABS(amount - :amount) < 0.01 AND type = :type
           AND (project_id <=> :projectId)
         LIMIT 1`,
        {
          vendor: row.vendor,
          date: row.date.slice(0, 10),
          amount: row.total || 0,
          type: row.type,
          projectId: resolvedProjectId
        }
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
         (import_batch_id, source_row_number, category_id, project_id, vendor, invoice_number, items, transaction_date, subtotal, sales_tax_paid, sales_tax_owed, amount, type, notes, review_status)
         VALUES (:batchId, :source_row_number, :categoryId, :projectId, :vendor, :invoice_number, :items, :transaction_date, :subtotal, :sales_tax_paid, :sales_tax_owed, :amount, :type, :notes, :review_status)`,
        {
          batchId,
          source_row_number: row.source_row_number,
          categoryId,
          projectId: resolvedProjectId,
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
          review_status: row.status === 'Needs Review'
            ? 'pending'
            : (row.type === 'Expense' && Number(row.total || 0) >= approvalThreshold ? 'pending_approval' : 'approved')
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
    res.json({ success: true, batchId, inserted, skipped, project_id: resolvedProjectId });
    } catch (innerErr) {
      await connection.rollback();
      throw innerErr;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Commit error:', error);
    res.status(500).json({ error: 'Failed to commit import.' });
  }
});

app.post('/api/quote-requests', async (req, res) => {
  try {
    const payload = req.body || {};
    const customer_name = String(payload.customer_name || '').trim();
    if (!customer_name) {
      return res.status(400).json({ error: 'customer_name is required.' });
    }

    const email = payload.email ? String(payload.email).trim() : null;
    const phone = payload.phone ? String(payload.phone).trim() : null;
    const service_type = payload.service_type ? String(payload.service_type).trim() : null;
    const project_address = payload.project_address ? String(payload.project_address).trim() : null;
    const preferred_contact = payload.preferred_contact ? String(payload.preferred_contact).trim() : null;
    const estimated_budget = payload.estimated_budget ? String(payload.estimated_budget).trim() : null;
    const message = payload.message ? String(payload.message).trim() : null;

    const [result] = await pool.query(
      `
      INSERT INTO quote_requests
        (customer_name, email, phone, service_type, project_address, preferred_contact, estimated_budget, message)
      VALUES
        (:customer_name, :email, :phone, :service_type, :project_address, :preferred_contact, :estimated_budget, :message)
      `,
      {
        customer_name,
        email: email || null,
        phone: phone || null,
        service_type: service_type || null,
        project_address: project_address || null,
        preferred_contact: preferred_contact || null,
        estimated_budget: estimated_budget || null,
        message: message || null
      }
    );

    return res.json({ success: true, id: result.insertId });
  } catch (error) {
    console.error('Quote request error:', error);
    return res.status(500).json({ error: 'Failed to submit quote request.' });
  }
});

app.get('/api/quote-requests', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;

  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
    const offset = (page - 1) * limit;
    const allowed = new Set(['new', 'contacted', 'scheduled', 'won', 'lost']);
    const statusFilterRaw = req.query.status != null ? String(req.query.status).trim() : '';
    const statusFilter = statusFilterRaw && allowed.has(statusFilterRaw) ? statusFilterRaw : null;

    const whereClause = statusFilter ? 'WHERE status = :statusFilter' : '';
    const countParams = statusFilter ? { statusFilter } : {};
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) as total FROM quote_requests ${whereClause}`,
      countParams
    );
    const total = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const listParams = { limit, offset, ...(statusFilter ? { statusFilter } : {}) };
    const [rows] = await pool.query(
      `
      SELECT
        id,
        customer_name,
        email,
        phone,
        service_type,
        project_address,
        preferred_contact,
        estimated_budget,
        message,
        status,
        internal_notes,
        created_at
      FROM quote_requests
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT :limit OFFSET :offset
      `,
      listParams
    );

    return res.json({
      quoteRequests: rows,
      pagination: { page, limit, total, totalPages }
    });
  } catch (error) {
    console.error('Quote requests list error:', error);
    return res.status(500).json({ error: 'Failed to fetch quote requests.' });
  }
});

app.get('/api/quote-requests/:id', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;

  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id.' });

    const [rows] = await pool.query(
      `
      SELECT
        id,
        customer_name,
        email,
        phone,
        service_type,
        project_address,
        preferred_contact,
        estimated_budget,
        message,
        status,
        internal_notes,
        created_at
      FROM quote_requests
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Quote request not found.' });
    return res.json({ quoteRequest: rows[0] });
  } catch (error) {
    console.error('Quote request get error:', error);
    return res.status(500).json({ error: 'Failed to fetch quote request.' });
  }
});

app.patch('/api/quote-requests/:id', async (req, res) => {
  if (!ensureCanEdit(req, res)) return;

  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id.' });

    const payload = req.body || {};
    const allowed = new Set(['new', 'contacted', 'scheduled', 'won', 'lost']);
    let status = null;
    if (Object.prototype.hasOwnProperty.call(payload, 'status') && payload.status != null) {
      const s = String(payload.status).trim();
      if (s) status = s;
    }
    const hasNotes = Object.prototype.hasOwnProperty.call(payload, 'internal_notes');
    const internal_notes = hasNotes
      ? payload.internal_notes == null
        ? null
        : String(payload.internal_notes)
      : undefined;

    if (status && !allowed.has(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    if (!status && !hasNotes) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const fields = [];
    const params = { id };
    if (status) {
      fields.push('status = :status');
      params.status = status;
    }
    if (hasNotes) {
      fields.push('internal_notes = :internal_notes');
      params.internal_notes = internal_notes;
    }

    const sql = `UPDATE quote_requests SET ${fields.join(', ')} WHERE id = :id`;
    const [result] = await pool.query(sql, params);

    if (!result.affectedRows) return res.status(404).json({ error: 'Quote request not found.' });
    return res.json({ success: true });
  } catch (error) {
    console.error('Quote request update error:', error);
    return res.status(500).json({ error: 'Failed to update quote request.' });
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

    let projectFilterSql = '';
    let exportProjectId = null;
    const projectIdRaw = req.query.project_id;
    if (
      projectIdRaw != null &&
      String(projectIdRaw).trim() !== '' &&
      String(projectIdRaw).toLowerCase() !== 'all'
    ) {
      const pid = Number(projectIdRaw);
      if (Number.isFinite(pid) && pid > 0) {
        projectFilterSql = ' AND t.project_id = ?';
        sqlParams = sqlParams.concat([pid]);
        exportProjectId = pid;
      }
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
      WHERE ${dateFilterSql}${projectFilterSql}
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

    const fileSuffix = exportProjectId ? `_project${exportProjectId}` : '';
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="RackettyBoom_Accountant_${filterValue}${fileSuffix}.xlsx"`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to generate export' });
  }
});

app.get('/api/settings/public', (req, res) => {
  res.json({ business_name: appSettings.business_name, logo_url: appSettings.logo_url, avatar_url: appSettings.avatar_url });
});

app.get('/api/settings', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  res.json({ ...appSettings });
});

const settingsUpload = upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'avatar', maxCount: 1 }]);

app.post('/api/settings', (req, res, next) => {
  if (!ensureAdmin(req, res)) return;
  next();
}, settingsUpload, async (req, res) => {
  const { business_name, app_pin } = req.body;
  let logo_url = appSettings.logo_url;
  let avatar_url = appSettings.avatar_url;

  if (req.files && req.files['logo']) {
    logo_url = `${APP_BASE_URL}/${UPLOAD_DIR}/${req.files['logo'][0].filename}`;
  }
  if (req.files && req.files['avatar']) {
    avatar_url = `${APP_BASE_URL}/${UPLOAD_DIR}/${req.files['avatar'][0].filename}`;
  }

  try {
    await pool.query(`
      UPDATE settings
      SET business_name = ?, app_pin = ?, logo_url = ?, avatar_url = ?
      WHERE id = 1
    `, [business_name || appSettings.business_name, app_pin || appSettings.app_pin, logo_url, avatar_url]);

    await reloadSettings();
    res.json({ success: true, settings: appSettings });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings.' });
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

const listenHost = process.env.HOST || '0.0.0.0';
app.listen(PORT, listenHost, () => {
  console.log(`Greg Tracker backend running on http://${listenHost}:${PORT}`);
});

(async () => {
  try {
    await ensureSchema();
    await reloadSettings();
    console.log('Backend schema and settings initialized.');
  } catch (error) {
    console.error('Failed to initialize backend resources:', error);
  }
})();
