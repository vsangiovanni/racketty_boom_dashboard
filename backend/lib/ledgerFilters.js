'use strict';

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
function buildLedgerWhereClause(query, { companyFieldExists, projectId, applyUserFilters, defaultCompanyName }) {
  const conditions = [];
  const params = {};

  if (companyFieldExists) {
    conditions.push('t.company = :company');
    params.company = defaultCompanyName;
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

module.exports = { hasTransactionsCompanyColumn, buildLedgerWhereClause };
