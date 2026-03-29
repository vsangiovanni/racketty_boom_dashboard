(function (global) {
  function normalizeText(value) {
    return String(value || '').toLowerCase().trim();
  }

  function txDayKey(tx) {
    if (!tx || !tx.date) return null;
    const d = new Date(tx.date);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function parseAmountBound(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function filterTransactions(transactions, criteria) {
    const list = Array.isArray(transactions) ? transactions : [];
    const type = criteria.type || 'all';
    const dateFrom = criteria.dateFrom || '';
    const dateTo = criteria.dateTo || '';
    const vendor = normalizeText(criteria.vendor || '');
    const category = normalizeText(criteria.category || '');
    const amountMin = parseAmountBound(criteria.amountMin);
    const amountMax = parseAmountBound(criteria.amountMax);

    return list.filter((tx) => {
      if (type !== 'all' && tx.type !== type) return false;

      const dk = txDayKey(tx);
      if (dateFrom && (!dk || dk < dateFrom)) return false;
      if (dateTo && (!dk || dk > dateTo)) return false;

      if (vendor && normalizeText(tx.vendor) !== vendor) return false;

      const catVal = normalizeText(tx.category || 'General');
      if (category && catVal !== category) return false;

      const amt = Math.abs(Number(tx.amount || 0));
      if (amountMin !== null && amt < amountMin) return false;
      if (amountMax !== null && amt > amountMax) return false;

      return true;
    });
  }

  function uniqueSorted(values) {
    const set = new Set();
    values.forEach((v) => {
      const s = String(v == null ? '' : v).trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function fillSelect(selectEl, options, emptyLabel) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = emptyLabel;
    selectEl.appendChild(opt0);
    options.forEach((label) => {
      const o = document.createElement('option');
      o.value = label;
      o.textContent = label;
      selectEl.appendChild(o);
    });
    if (current && Array.from(selectEl.options).some((o) => o.value === current)) {
      selectEl.value = current;
    }
  }

  function populateVendorCategorySelects(vendorSelect, categorySelect, transactions) {
    const txs = Array.isArray(transactions) ? transactions : [];
    const vendors = uniqueSorted(txs.map((t) => t.vendor));
    const categories = uniqueSorted(txs.map((t) => t.category || 'General'));
    fillSelect(vendorSelect, vendors, 'All vendors');
    fillSelect(categorySelect, categories, 'All categories');
  }

  global.GregLedgerFilters = {
    filterTransactions,
    populateVendorCategorySelects,
    normalizeText
  };
})(typeof window !== 'undefined' ? window : this);
