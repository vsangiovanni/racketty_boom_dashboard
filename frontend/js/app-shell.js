/**
 * Nombre de empresa (API publica) + pie (Te amooooooo) en todas las pantallas.
 * Marca contenedores con data-shell-footer para insertar el pie al final.
 * Elementos .shell-business-name reciben el texto de negocio.
 */
(function () {
  var CREDIT_LIGHT =
    'Te amooooooo <span class="inline-block text-rose-500" aria-hidden="true">\u2764\uFE0F</span>';
  var CREDIT_DARK =
    'Te amooooooo <span class="inline-block text-rose-400" aria-hidden="true">\u2764\uFE0F</span>';

  function mountFooters() {
    document.querySelectorAll('[data-shell-footer]').forEach(function (host) {
      if (host.querySelector('[data-shell-footer-done]')) return;
      var f = document.createElement('footer');
      f.setAttribute('data-shell-footer-done', '');
      var dark = host.hasAttribute('data-shell-footer-dark');
      f.className = dark
        ? 'shell-footer text-center text-[11px] sm:text-xs text-slate-500 leading-relaxed py-4 px-4 border-t border-slate-800/80'
        : 'shell-footer text-center text-[11px] sm:text-xs text-slate-400 leading-relaxed pt-8 pb-4 px-4 mt-auto border-t border-slate-200/80';
      f.innerHTML = dark ? CREDIT_DARK : CREDIT_LIGHT;
      host.appendChild(f);
    });
  }

  async function hydrateBusinessNames() {
    var business = '';
    try {
      var r = await fetch('/api/settings/public');
      var j = await r.json();
      if (j && j.business_name) business = String(j.business_name);
    } catch (e) {}
    if (!business) return;
    document.querySelectorAll('.shell-business-name').forEach(function (el) {
      el.textContent = business;
    });
  }

  function init() {
    mountFooters();
    hydrateBusinessNames();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
