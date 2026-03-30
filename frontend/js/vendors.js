async function loadActiveVendors() {
  try {
    const res = await fetch('/api/vendors?active=1');
    if (!res.ok) throw new Error('Failed to load vendors');
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    return [];
  } catch (e) {
    console.error('Error loading vendors', e);
    return [];
  }
}

async function initVendorDropdown(selectId, hiddenInputId) {
  const select = document.getElementById(selectId);
  const hidden = document.getElementById(hiddenInputId);
  if (!select || !hidden) return;

  const currentValue = hidden.value || '';
  const vendors = await loadActiveVendors();

  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select vendor...';
  select.appendChild(placeholder);

  vendors.forEach(function (v) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name;
    select.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New vendor...';
  select.appendChild(newOpt);

  if (currentValue) {
    const match = vendors.find(function (v) { return v.name === currentValue; });
    if (match) {
      select.value = currentValue;
    } else {
      const customOpt = document.createElement('option');
      customOpt.value = currentValue;
      customOpt.textContent = currentValue + ' (custom)';
      select.insertBefore(customOpt, newOpt);
      select.value = currentValue;
    }
  }

  select.addEventListener('change', async function () {
    if (select.value === '__new__') {
      const name = (window.prompt('Vendor name:') || '').trim();
      if (!name) {
        select.value = hidden.value || '';
        return;
      }
      try {
        const res = await fetch('/api/vendors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, type: 'Vendor', active: true })
        });
        if (!res.ok) {
          const err = await res.json().catch(function () { return {}; });
          throw new Error(err.error || 'Failed to create vendor');
        }
        const created = await res.json();
        hidden.value = created.name;
        await initVendorDropdown(selectId, hiddenInputId);
        const sel = document.getElementById(selectId);
        if (sel) sel.value = created.name;
      } catch (e) {
        window.alert('Error creating vendor: ' + e.message);
        select.value = hidden.value || '';
      }
      return;
    }

    hidden.value = select.value;
  });
}

