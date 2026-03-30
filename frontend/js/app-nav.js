/**
 * Sidebar compartido: toggle movil, logo publico, enlaces Admin / Quote requests.
 */
(function (global) {
  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  function toggleSidebar() {
    var sb = document.getElementById('sidebar');
    var ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.toggle('-translate-x-full');
    if (ov) ov.classList.toggle('hidden');
  }

  async function hydrateSidebarLogo() {
    var el = document.getElementById('sidebar-logo-container');
    if (!el) return;
    var defaultUrl =
      (typeof window !== 'undefined' && window.GREG_TRACKER_DEFAULT_LOGO_URL) ||
      '/assets/landing/logo.svg';
    var url = defaultUrl;
    try {
      var res = await fetch('/api/settings/public');
      if (res.ok) {
        var data = await res.json();
        if (data.logo_url) url = data.logo_url;
      }
    } catch (e) {}
    el.innerHTML =
      '<img src="' + escapeHtml(url) + '" class="w-full h-full object-contain" alt="" />';
    el.classList.remove(
      'bg-gradient-to-br',
      'from-blue-500',
      'to-indigo-600',
      'text-white',
      'font-bold'
    );
  }

  async function hydrateSidebarNav() {
    try {
      var res = await fetch('/api/session/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      var me = await res.json();
      var role = me.role || '';
      if (role === 'Manager' || role === 'Admin') {
        var qr = document.getElementById('nav-quote-requests');
        if (qr) qr.classList.remove('hidden');
        var vv = document.getElementById('nav-vendors');
        if (vv) vv.classList.remove('hidden');
      }
      if (role === 'Admin') {
        var team = document.getElementById('nav-team-users');
        if (team) team.classList.remove('hidden');
        var sn = document.getElementById('nav-settings');
        if (sn) sn.classList.remove('hidden');
      }
    } catch (e) {}
    try {
      if (typeof global.hydrateQuoteRequestsBadge === 'function') {
        await global.hydrateQuoteRequestsBadge();
      }
    } catch (e2) {}
  }

  async function logout() {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {}
    window.location.href = '/login.html';
  }

  global.toggleSidebar = toggleSidebar;
  global.hydrateSidebarLogo = hydrateSidebarLogo;
  global.hydrateSidebarNav = hydrateSidebarNav;
  global.escapeHtml = escapeHtml;
  global.logout = logout;
})(typeof window !== 'undefined' ? window : this);
