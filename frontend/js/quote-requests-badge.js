/**
 * Badge en sidebar: solicitudes de presupuesto que el equipo aun no abrio (detalle).
 * Requiere #nav-quote-requests (visible) y #nav-quote-requests-badge.
 */
(function (global) {
  var pollId = null;

  async function hydrateQuoteRequestsBadge() {
    var badge = document.getElementById('nav-quote-requests-badge');
    var link = document.getElementById('nav-quote-requests');
    if (!badge || !link || link.classList.contains('hidden')) return;
    try {
      var res = await fetch('/api/quote-requests/unread-count', { credentials: 'same-origin' });
      if (res.status === 403 || res.status === 401) return;
      if (!res.ok) return;
      var data = await res.json();
      var n = Number(data.unreadCount != null ? data.unreadCount : data.count || 0);
      if (n > 0) {
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.classList.remove('hidden');
        badge.setAttribute('aria-label', n + ' quote requests not opened yet');
      } else {
        badge.textContent = '';
        badge.classList.add('hidden');
        badge.removeAttribute('aria-label');
      }
      if (pollId == null) {
        pollId = global.setInterval(hydrateQuoteRequestsBadge, 90000);
      }
    } catch (e) {}
  }

  global.hydrateQuoteRequestsBadge = hydrateQuoteRequestsBadge;
})(typeof window !== 'undefined' ? window : this);
