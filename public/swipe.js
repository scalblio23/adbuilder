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
  var viewBtn = document.getElementById('swipeView');
  var view = 'grid';
  try { view = localStorage.getItem('adbuilder.swipeView') === 'rows' ? 'rows' : 'grid'; } catch (e) {}
  function applyView() {
    grid.classList.toggle('swipes--rows', view === 'rows');
    viewBtn.textContent = view === 'rows' ? 'Grid' : 'Rows';
    viewBtn.setAttribute('aria-pressed', String(view === 'rows'));
  }
  viewBtn.addEventListener('click', function () {
    view = view === 'rows' ? 'grid' : 'rows';
    try { localStorage.setItem('adbuilder.swipeView', view); } catch (e) {}
    applyView(); render();
  });
  applyView();

  // Collapse the whole list to its header line.
  var collapseBtn = document.getElementById('swipeCollapse');
  var collapsed = false;
  try { collapsed = localStorage.getItem('adbuilder.swipeCollapsed') === '1'; } catch (e) {}
  function applyCollapsed() {
    grid.hidden = collapsed;
    empty.hidden = collapsed || !loaded || items.length > 0;
    collapseBtn.textContent = collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  collapseBtn.addEventListener('click', function () {
    collapsed = !collapsed;
    try { localStorage.setItem('adbuilder.swipeCollapsed', collapsed ? '1' : '0'); } catch (e) {}
    applyCollapsed();
  });

  // Per-advertiser groups in rows view; remembered per advertiser.
  var closedGroups = {};
  try { closedGroups = JSON.parse(localStorage.getItem('adbuilder.swipeGroups') || '{}') || {}; } catch (e) {}
  function rememberGroups() { try { localStorage.setItem('adbuilder.swipeGroups', JSON.stringify(closedGroups)); } catch (e) {} }

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

  function savedAt(item) {
    var t = item.firstSeenAt || item.createdAt;
    if (!t) return null;
    var d = new Date(t);
    return el('span', { 'class': 'swipe__time', text: d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), title: 'Saved ' + d.toLocaleString() });
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
        el('div', { 'class': 'swipe__advertiser' }, [el('span', { text: item.advertiser || 'Unknown advertiser' }), savedAt(item)]),
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

  function row(item) {
    var thumb = el('div', { 'class': 'swipe-row__thumb' });
    var src = item.thumbnailUrl || (item.mediaType !== 'video' ? item.mediaUrl : '');
    if (src) thumb.appendChild(el('img', { src: src, alt: '', loading: 'lazy' }));
    else thumb.appendChild(el('span', { text: item.mediaType === 'video' ? '▶' : '🖼' }));
    var expanded = false;
    var detail = el('div', { 'class': 'swipe-row__detail' }, [
      item.copy ? el('div', { 'class': 'rules-text', text: item.copy }) : el('span', { 'class': 'muted', text: 'No copy captured.' }),
      el('div', { 'class': 'swipe__meta', style: 'margin-top:8px' }, [
        item.cta ? el('span', { text: 'CTA: ' + item.cta }) : null,
        item.landingUrl ? el('a', { href: item.landingUrl, target: '_blank', rel: 'noopener', text: 'Landing page ↗' }) : null,
        el('a', { href: 'https://www.facebook.com/ads/library/?id=' + encodeURIComponent(item.id), target: '_blank', rel: 'noopener', text: 'Library ' + item.id + ' ↗' }),
        item.startedAt ? el('span', { text: 'Started ' + new Date(item.startedAt).toLocaleDateString() } ) : null
      ]),
      item.mediaType === 'video' && item.mediaUrl ? el('video', { src: item.mediaUrl, controls: 'controls', preload: 'none', style: 'max-width:360px;margin-top:8px;display:block' }) : null
    ]);
    detail.hidden = true;
    var wrap = el('div', { 'class': 'swipe-row' + (item.active ? '' : ' is-inactive') });
    var line = el('div', { 'class': 'swipe-row__line', onclick: function (e) { if (e.target.closest('button, a')) return; expanded = !expanded; detail.hidden = !expanded; wrap.classList.toggle('is-open', expanded); } }, [
      thumb,
      el('div', { 'class': 'swipe-row__text' }, [
        el('div', { 'class': 'swipe__advertiser' }, [el('span', { text: item.advertiser || 'Unknown advertiser' }), savedAt(item)]),
        el('div', { 'class': 'swipe-row__sub', text: item.headline || (item.copy || '').split('\n')[0] || '' })
      ]),
      el('span', { 'class': 'swipe__type swipe-row__type', text: item.mediaType || 'image' }),
      el('span', { 'class': 'badge ' + (item.active ? 'badge--live' : 'badge--paused'), text: item.active ? 'Active' : 'Inactive' }),
      stars(item),
      el('div', { 'class': 'btn-row' }, [
        el('button', { type: 'button', 'class': 'btn btn--small', text: item.active ? 'Inactive' : 'Active', title: item.active ? 'Mark inactive' : 'Mark active', onclick: function () { save(item, { active: !item.active }); } }),
        el('button', { type: 'button', 'class': 'btn btn--small btn--danger', text: 'Delete', onclick: function () {
          if (!confirm('Delete this creative from the swipe file?')) return;
          request('DELETE', '/api/swipes/' + item.id).then(load, function (err) { setNotice('error', 'Could not delete: ' + err.message); });
        } })
      ])
    ]);
    wrap.appendChild(line); wrap.appendChild(detail);
    return wrap;
  }

  function group(name, members) {
    var open = !closedGroups[name];
    var body = el('div', { 'class': 'swipe-group__body' });
    members.forEach(function (i) { body.appendChild(row(i)); });
    body.hidden = !open;
    var active = members.filter(function (i) { return i.active; }).length;
    var head = el('button', { type: 'button', 'class': 'swipe-group__head' + (open ? ' is-open' : ''), 'aria-expanded': String(open), onclick: function () {
      open = !open; body.hidden = !open; head.classList.toggle('is-open', open); head.setAttribute('aria-expanded', String(open));
      if (open) delete closedGroups[name]; else closedGroups[name] = 1;
      rememberGroups();
    } }, [
      el('span', { 'class': 'swipe-group__caret', text: '▸' }),
      el('span', { 'class': 'swipe-group__name', text: name }),
      el('span', { 'class': 'swipe-group__count', text: members.length + (members.length === 1 ? ' creative' : ' creatives') + ', ' + active + ' active' })
    ]);
    return el('div', { 'class': 'swipe-group' }, [head, body]);
  }

  function render() {
    grid.innerHTML = '';
    var list = visible();
    if (view === 'rows') {
      var names = [], byName = {};
      list.forEach(function (i) { var n = i.advertiser || 'Unknown advertiser'; if (!byName[n]) { byName[n] = []; names.push(n); } byName[n].push(i); });
      names.sort(function (a, b) { return a.localeCompare(b); });
      names.forEach(function (n) { grid.appendChild(group(n, byName[n])); });
    } else {
      list.forEach(function (i) { grid.appendChild(card(i)); });
    }
    applyCollapsed();
    if (loaded && items.length && !list.length) grid.appendChild(el('p', { 'class': 'muted', text: 'No creatives match these filters.' }));
  }

  [search, typeSel, activeSel, advSel].forEach(function (c) { c.addEventListener('input', render); c.addEventListener('change', render); });
  refresh.addEventListener('click', load);
  load();
  setInterval(function () { if (location.hash === '#creatives' && !document.hidden) load(); }, 8000);
  window.addEventListener('hashchange', function () { if (location.hash === '#creatives') load(); });
})();
