(function () {
  if (typeof document === 'undefined' || !document.head) return;
  var head = document.head;
  var pkg = '/assets/genfavicon-package';
  function add(rel, href, attrs) {
    if (head.querySelector('link[rel="' + rel + '"][href="' + href + '"]')) return;
    var l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        l.setAttribute(k, attrs[k]);
      });
    }
    head.insertBefore(l, head.firstChild);
  }
  add('icon', '/favicon.ico', { sizes: 'any' });
  add('icon', pkg + '/genfavicon-32.png', { type: 'image/png', sizes: '32x32' });
  add('icon', pkg + '/genfavicon-16.png', { type: 'image/png', sizes: '16x16' });
  add('apple-touch-icon', pkg + '/apple-touch-icon-180x180.png', { sizes: '180x180' });
  add('manifest', '/manifest.webmanifest', { type: 'application/manifest+json' });
})();

(function (w) {
  w.GREG_TRACKER_DEFAULT_LOGO_URL = '/assets/landing/logo.svg';
})(typeof window !== 'undefined' ? window : this);
