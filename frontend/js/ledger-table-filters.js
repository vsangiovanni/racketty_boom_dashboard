(function (global) {
  function fillSelect(selectEl, optionValues, emptyLabel) {
    if (!selectEl) return;
    const current = selectEl.value;
    selectEl.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = emptyLabel;
    selectEl.appendChild(opt0);
    (optionValues || []).forEach((label) => {
      const o = document.createElement('option');
      o.value = label;
      o.textContent = label;
      selectEl.appendChild(o);
    });
    if (current && Array.from(selectEl.options).some((o) => o.value === current)) {
      selectEl.value = current;
    }
  }

  function applyFilterOptionsToSelects(vendorSelect, categorySelect, payload) {
    const vendors = Array.isArray(payload.vendors) ? payload.vendors : [];
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    fillSelect(vendorSelect, vendors, 'All vendors');
    fillSelect(categorySelect, categories, 'All categories');
  }

  global.GregLedgerFilters = {
    applyFilterOptionsToSelects
  };
})(typeof window !== 'undefined' ? window : this);
