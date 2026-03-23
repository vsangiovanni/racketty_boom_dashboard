const xlsx = require('xlsx');

function normalizeHeader(text) {
  return String(text || '').trim().toUpperCase().replace(/[#.:]/g, '').replace(/\s+/g, '_');
}

function parseAmount(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const num = Number(String(val).replace(/[$,]/g, '').replace(/\(([^)]+)\)/, '-$1'));
  return Number.isNaN(num) ? 0 : num;
}

function parseExcelDate(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') {
    const parsed = xlsx.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString().slice(0, 10);
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

class ExcelImportService {
  static parseWorkbook(buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer', raw: true });
    const results = [];
    
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
      
      let headerIdx = -1;
      let headers = [];
      
      for (let i = 0; i < Math.min(rawRows.length, 30); i++) {
        const rowString = (rawRows[i] || []).map(normalizeHeader).join(' ');
        if (rowString.includes('DATE') && (rowString.includes('VENDOR') || rowString.includes('PAY_TO') || rowString.includes('CUSTOMER') || rowString.includes('ITEM'))) {
          headerIdx = i;
          headers = (rawRows[i] || []).map(normalizeHeader);
          break;
        }
      }

      if (headerIdx === -1) continue;

      const map = {
        date: headers.findIndex(h => h.includes('DATE')),
        vendor: headers.findIndex(h => h.includes('PAY_TO') || h.includes('VENDOR') || h.includes('CUSTOMER')),
        invoice: headers.findIndex(h => h.includes('INVOICE')),
        items: headers.findIndex(h => h === 'ITEMS' || h === 'ITEM(S)' || h === 'ITEM' || h === 'DESCRIPTION'),
        income: headers.findIndex(h => h.includes('INCOME') || h.includes('DEPOSIT')),
        expense: headers.findIndex(h => h.includes('EXPENSE') || h.includes('COST') || h.includes('PAID')),
        subtotal: headers.findIndex(h => h.includes('SUBTOTAL')),
        taxPaid: headers.findIndex(h => h.includes('TAX_PAID') || h.includes('SALES_TAX_PAID')),
        taxOwed: headers.findIndex(h => h.includes('TAX_OWED') || h.includes('SALES_TAX_OWED')),
        tax: headers.findIndex(h => h === 'TAX' || h === 'SALES_TAX'), // fallback
        total: headers.findIndex(h => h === 'TOTAL'),
        category: headers.findIndex(h => h.includes('CATEGORY')),
        notes: headers.findIndex(h => h.includes('NOTE') || h.includes('MEMO'))
      };

      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || !row.some(cell => cell)) continue;

        const flags = [];
        let type = null;
        let amount = 0;

        const date = parseExcelDate(row[map.date]);
        const vendor = String(row[map.vendor] || '').trim();
        const items = map.items >= 0 ? String(row[map.items] || '').trim() : null;
        const invoiceNum = map.invoice >= 0 && row[map.invoice] ? String(row[map.invoice]).trim() : null;
        
        const incVal = parseAmount(row[map.income]);
        const expVal = parseAmount(row[map.expense]);
        const subVal = parseAmount(row[map.subtotal]);
        let taxPaidVal = parseAmount(row[map.taxPaid]);
        let taxOwedVal = parseAmount(row[map.taxOwed]);
        const genTaxVal = parseAmount(row[map.tax]);
        let totVal = parseAmount(row[map.total]);

        if (incVal > 0 && expVal === 0) { type = 'Income'; amount = incVal; }
        else if (expVal > 0 && incVal === 0) { type = 'Expense'; amount = expVal; }
        else if (incVal > 0 && expVal > 0) {
          flags.push({ type: 'Both values present', msg: 'Row has both Income and Expense values.', severity: 'High' });
        }

        // Fallback for generic tax column
        if (taxPaidVal === 0 && taxOwedVal === 0 && genTaxVal > 0) {
           if (type === 'Expense') taxPaidVal = genTaxVal;
           if (type === 'Income') taxOwedVal = genTaxVal;
        }

        if (totVal === 0 && subVal > 0) {
          totVal = subVal + taxPaidVal + taxOwedVal;
          flags.push({ type: 'Total Inferred', msg: 'Total computed from subtotal + tax.', severity: 'Low' });
        }
        
        if (!type && totVal > 0) {
           amount = totVal;
           flags.push({ type: 'Manual Review', msg: 'Could not determine if Income or Expense automatically.', severity: 'High' });
        }

        if (invoiceNum && !isNaN(Number(invoiceNum)) && Number(invoiceNum) > 40000) {
           flags.push({ type: 'Suspicious Invoice', msg: 'Invoice number looks like an Excel date format.', severity: 'Medium' });
        }

        if (!date && !vendor && amount === 0) continue;

        results.push({
          source_row_number: i + 1,
          date,
          vendor,
          items,
          invoice_number: invoiceNum,
          subtotal: subVal,
          sales_tax_paid: taxPaidVal,
          sales_tax_owed: taxOwedVal,
          total: totVal > 0 ? totVal : amount,
          type: type || 'Expense',
          category: map.category >= 0 ? String(row[map.category] || '').trim() : 'General',
          notes: map.notes >= 0 ? String(row[map.notes] || '').trim() : null,
          status: flags.length > 0 ? 'Needs Review' : 'Ready',
          flags
        });
      }
    }
    return results;
  }
}

module.exports = ExcelImportService;