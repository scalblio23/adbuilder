// Creative Swipe File: Meta Ad Library creatives collected by Hermes, stored on the server.
(function () {
  var grid = document.getElementById('swipeGrid');
  if (!grid) return;
  var empty = document.getElementById('swipeEmpty');
  var notice = document.getElementById('swipeNotice');
  var noticeText = document.getElementById('swipeNoticeText');
  var search = document.getElementById('swipeSearch');
  var typeSel = document.getElementById('swipeType');
  var activeSel = document.getElementById('swipeActive');
  var advSel = document.getElementById('swipeAdvertiser');
  var refresh = document.getElementById('swipeRefresh');

  var items = [];
  var loaded = false;

  function setNotice(kind, text) { notice.className = 'notice' + (kind ? ' notice--' + kind : ''); noticeText.textContent = text; }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function request(method, url, data) {
    return fetch(url, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' })
      .then(function (res) { return res.text().then(function (t) { var j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; } if (!res.ok) throw new Error((j && j.error) || ('Server returned ' + res.status)); return j; }); });
  }

  function load() {
    return request('GET', '/api/swipes').then(function (list) {
      items = list || [];
      loaded = true;
      var advertisers = {};
      items.forEach(function (i) { if (i.advertiser) advertisers[i.advertiser] = true; });
      var current = advSel.value;
      advSel.innerHTML = '';
      advSel.appendChild(el('option', { value: '', text: 'All advertisers' }));
      Object.keys(advertisers).sort().forEach(function (a) { advSel.appendChild(el('option', { value: a, text: a })); });
      advSel.value = current;
      var active = items.filter(function (i) { return i.active; }).length;
      setNotice('ok', items.length + ' creative' + (items.length === 1 ? '' : 's') + ' saved, ' + active + ' active. Hermes adds new ones through the API.');
      render();
    }, function (err) { setNotice('error', 'Could not load the swipe file: ' + err.message); });
  }

  function save(item, changes) {
    Object.assign(item, changes);
    render();
    request('PUT', '/api/swipes/' + item.id, changes).then(function () {}, function (err) { setNotice('error', 'Could not save: ' + err.message); load(); });
  }

  function visible() {
    var q = search.value.trim().toLowerCase();
    return items.filter(function (i) {
      if (typeSel.value && i.mediaType !== typeSel.value) return false;
      if (activeSel.value === '1' && !i.active) return false;
      if (activeSel.value === '0' && i.active) return false;
      if (advSel.value && i.advertiser !== advSel.value) return false;
      if (q && [i.advertiser, i.copy, i.headline, i.cta, i.landingUrl, i.id].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function mediaFor(item) {
    var box = el('div', { 'class': 'swipe__media' });
    if (item.mediaType === 'video' && item.mediaUrl) {
      var v = el('video', { src: item.mediaUrl, controls: 'controls', preload: 'metadata', playsinline: 'playsinline' });
      if (item.thumbnailUrl) v.setAttribute('poster', item.thumbnailUrl);
      box.appendChild(v);
    } else if (item.mediaUrl || item.thumbnailUrl) {
      box.appendChild(el('img', { src: item.mediaUrl || item.thumbnailUrl, alt: item.headline || item.advertiser || 'creative', loading: 'lazy' }));
    } else {
      box.appendChild(el('div', { 'class': 'creative__thumb creative__thumb--icon', text: '🖼' }));
    }
    box.appendChild(el('span', { 'class': 'swipe__type', text: item.mediaType || 'image' }));
    box.appendChild(el('span', { 'class': 'badge swipe__status ' + (item.active ? 'badge--live' : 'badge--paused'), text: item.active ? 'Active' : 'Inactive' }));
    return box;
  }

  function stars(item) {
    var wrap = el('div', { 'class': 'stars', title: 'Ranking' });
    for (var n = 1; n <= 5; n++) (function (n) {
      wrap.appendChild(el('button', { type: 'button', 'class': n <= (item.ranking || 0) ? 'is-on' : '', text: '★', 'aria-label': n + ' star', onclick: function () { save(item, { ranking: item.ranking === n ? 0 : n }); } }));
    })(n);
    return wrap;
  }

  function card(item) {
    var copy = el('div', { 'class': 'swipe__copy', text: item.copy || '', title: 'Click to expand', onclick: function () { copy.classList.toggle('is-open'); } });
    var when = function (t) { return t ? new Date(t).toLocaleDateString() : ''; };
    var libraryLink = 'https://www.facebook.com/ads/library/?id=' + encodeURIComponent(item.id);
    return el('div', { 'class': 'swipe' + (item.active ? '' : ' is-inactive') }, [
      mediaFor(item),
      el('div', { 'class': 'swipe__body' }, [
        el('div', { 'class': 'swipe__advertiser', text: item.advertiser || 'Unknown advertiser' }),
        item.headline ? el('div', { 'class': 'swipe__headline', text: item.headline }) : null,
        item.copy ? copy : null,
        el('div', { 'class': 'swipe__meta' }, [
          item.cta ? el('span', { text: 'CTA: ' + item.cta }) : null,
          item.landingUrl ? el('a', { href: item.landingUrl, target: '_blank', rel: 'noopener', text: 'Landing page ↗' }) : null,
          el('a', { href: libraryLink, target: '_blank', rel: 'noopener', text: 'Library ' + item.id + ' ↗' }),
          item.startedAt ? el('span', { text: 'Started ' + when(item.startedAt) }) : null,
          item.lastSeenAt ? el('span', { text: 'Seen ' + when(item.lastSeenAt) }) : null
        ]),
        el('div', { 'class': 'swipe__actions' }, [
          stars(item),
          el('div', { 'class': 'btn-row' }, [
            el('button', { type: 'button', 'class': 'btn btn--small', text: item.active ? 'Mark inactive' : 'Mark active', onclick: function () { save(item, { active: !item.active }); } }),
            el('button', { type: 'button', 'class': 'btn btn--small btn--danger', text: 'Delete', onclick: function () {
              if (!confirm('Delete this creative from the swipe file?')) return;
              request('DELETE', '/api/swipes/' + item.id).then(load, function (err) { setNotice('error', 'Could not delete: ' + err.message); });
            } })
          ])
        ])
      ])
    ]);
  }

  function render() {
    grid.innerHTML = '';
    var list = visible();
    list.forEach(function (i) { grid.appendChild(card(i)); });
    empty.hidden = !loaded || items.length > 0;
    if (loaded && items.length && !list.length) grid.appendChild(el('p', { 'class': 'muted', text: 'No creatives match these filters.' }));
  }

  [search, typeSel, activeSel, advSel].forEach(function (c) { c.addEventListener('input', render); c.addEventListener('change', render); });
  refresh.addEventListener('click', load);
  load();
  setInterval(function () { if (location.hash === '#creatives' && !document.hidden) load(); }, 30000);
})();
