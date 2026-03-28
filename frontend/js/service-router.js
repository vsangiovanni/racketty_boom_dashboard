(function () {
  function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  var serviceTitleEl = document.getElementById('service-title');
  var serviceLeadEl = document.getElementById('service-lead');
  var serviceBodyEl = document.getElementById('service-body');
  var serviceGalleryEl = document.getElementById('service-gallery');
  var serviceReviewsEl = document.getElementById('service-reviews');

  var slugKey = window.location.pathname.replace(/^\//, '');

  function renderReviews(reviews) {
    var list = Array.isArray(reviews) ? reviews : [];
    var html = '';
    if (!list.length) {
      html = '<div class="review-card"><p style="margin:0;color:var(--muted);font-size:.9rem;">No reviews yet.</p></div>';
      serviceReviewsEl.innerHTML = html;
      return;
    }

    list.slice(0, 6).forEach(function (r) {
      html += [
        '<div class="review-card">',
          '<div class="stars" aria-hidden="true">★★★★★</div>',
          '<p class="review-quote">&ldquo;' + escapeHtml(r.quote) + '&rdquo;</p>',
          '<p class="review-meta">— ' + escapeHtml(r.meta) + '</p>',
        '</div>'
      ].join('');
    });

    serviceReviewsEl.innerHTML = html;
  }

  function renderGallery(images, title) {
    var list = Array.isArray(images) ? images : [];
    var html = '';
    if (!list.length) {
      serviceGalleryEl.innerHTML = '<div class="review-card" style="grid-column:1/-1;"><p style="margin:0;color:var(--muted);font-size:.9rem;">No photos available yet.</p></div>';
      return;
    }
    list.forEach(function (src, idx) {
      html += [
        '<a class="gallery-item" href="' + escapeHtml(src) + '" target="_blank" rel="noopener noreferrer">',
        '<img src="' + escapeHtml(src) + '" loading="lazy" alt="' + escapeHtml((title || 'Service') + ' photo ' + (idx + 1)) + '"/>',
        '</a>'
      ].join('');
    });
    serviceGalleryEl.innerHTML = html;
  }

  function renderService(item) {
    if (!item) {
      serviceTitleEl.textContent = 'Service';
      serviceLeadEl.textContent = 'Request a free estimate and we will follow up with next steps.';
      serviceBodyEl.innerHTML = '<p>Loading service details…</p>';
      renderReviews([]);
      return;
    }

    document.title = item.seoTitle || ('Racketty Boom — ' + item.title);
    serviceTitleEl.textContent = item.title || 'Service';
    serviceLeadEl.textContent = item.lead || '';

    var paragraphs = Array.isArray(item.paragraphs) ? item.paragraphs : [];
    if (!paragraphs.length) paragraphs = item.body ? [item.body] : [];

    var bodyHtml = '';
    paragraphs.forEach(function (p) {
      bodyHtml += '<p>' + escapeHtml(p).replace(/\n/g, '<br/>') + '</p>';
    });
    serviceBodyEl.innerHTML = bodyHtml || '<p> </p>';

    renderGallery(item.images || [], item.title || 'Service');
    renderReviews(item.reviews || []);
  }

  fetch('/data/service-content.json', { credentials: 'same-origin' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var item = data && (data[slugKey] || data.default);
      renderService(item);
    })
    .catch(function () {
      renderService(null);
    });
})();

