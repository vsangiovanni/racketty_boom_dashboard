function ensureLocationModalExists() {
  if (document.getElementById('create-location-modal')) return;
  var html =
    '<div id="create-location-modal" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">' +
    '<div class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">' +
    '<div class="p-6 border-b border-slate-100 flex justify-between items-center">' +
    '<h2 class="text-xl font-bold text-slate-800">New location</h2>' +
    '<button type="button" onclick="closeLocationModal()" class="text-slate-400 hover:text-slate-600" aria-label="Close">' +
    '<span class="material-icons-round">close</span></button></div>' +
    '<form id="create-location-form" class="p-6 space-y-4">' +
    '<div><label class="block text-sm font-semibold text-slate-700 mb-1" for="new-location-name">City or place</label>' +
    '<input type="text" id="new-location-name" class="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 outline-none" placeholder="e.g. Centralia" required maxlength="100"></div>' +
    '<p class="text-xs text-slate-500">Saves to the list for next time. Duplicates (same spelling, any case) reuse the existing name.</p>' +
    '<div class="pt-2 flex gap-3">' +
    '<button type="button" onclick="closeLocationModal()" class="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200">Cancel</button>' +
    '<button type="submit" class="flex-1 px-4 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">Save</button></div></form></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function fetchLocationNames() {
  try {
    const res = await fetch('/api/locations', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('fetchLocationNames', e);
    return [];
  }
}

async function refreshLocationsDatalist(datalistId) {
  var id = datalistId || 'locations_datalist';
  var dl = document.getElementById(id);
  if (!dl) return;
  var names = await fetchLocationNames();
  dl.innerHTML = '';
  names.forEach(function (n) {
    var opt = document.createElement('option');
    opt.value = n;
    dl.appendChild(opt);
  });
}

function openLocationModal() {
  var m = document.getElementById('create-location-modal');
  if (m) m.classList.remove('hidden');
}

function closeLocationModal() {
  var m = document.getElementById('create-location-modal');
  if (m) m.classList.add('hidden');
  var f = document.getElementById('create-location-form');
  if (f) f.reset();
}

/**
 * Enlaza el modal "Nueva ubicacion" al POST /api/locations y refresca el datalist.
 * @param {{ datalistId?: string, inputId?: string }} options
 */
function initLocationField(options) {
  options = options || {};
  var datalistId = options.datalistId || 'locations_datalist';
  var inputId = options.inputId || 'location';
  ensureLocationModalExists();
  var form = document.getElementById('create-location-form');
  if (!form || form.dataset.locationBound === '1') return;
  form.dataset.locationBound = '1';
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = document.getElementById('new-location-name');
    var name = (inp && inp.value) ? String(inp.value).trim() : '';
    if (!name) return;
    fetch('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: name })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.error) || 'Failed to save');
          return data;
        });
      })
      .then(function (data) {
        var canonical = (data && data.name) ? data.name : name;
        return refreshLocationsDatalist(datalistId).then(function () {
          return canonical;
        });
      })
      .then(function (canonical) {
        var locInput = document.getElementById(inputId);
        if (locInput) locInput.value = canonical;
        closeLocationModal();
      })
      .catch(function (err) {
        window.alert(err.message || String(err));
      });
  });
}
