// Master stats: one big cell per client (from the Clients manager on the Campaigns tab), alphabetical,
// with the bookings logged for it in the last 30 days. Data: GET /api/clients and GET /api/bookings.
(function () {
  var root = document.getElementById('masterPage');
  if (!root) return;
  var DAYS = 30;
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') node.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]); else node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  var SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, children) { var n = document.createElementNS(SVG, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); (children || []).forEach(function (c) { if (c) n.appendChild(c); }); return n; }
  function request(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status); return b; }); }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayKey(offset) { var d = new Date(); d.setDate(d.getDate() - offset); return iso(d); }
  function short(k) { var p = k.split('-'); return Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1]; }
  var pct = function (v) { return (v * 100).toLocaleString('en-AU', { maximumFractionDigits: 0 }) + '%'; };

  function bars(byDate, dates) {
    var W = 300, H = 40, n = dates.length, max = 0;
    dates.forEach(function (d) { max = Math.max(max, byDate[d] || 0); });
    var kids = dates.map(function (d, i) {
      var v = byDate[d] || 0, bh = max ? Math.max(v ? 2 : 0, (H - 2) * v / max) : 0;
      return s('rect', { x: (W * i / n).toFixed(1), y: (H - bh).toFixed(1), width: (W / n - 1.5).toFixed(1), height: bh.toFixed(1), rx: 1, fill: v ? '#2ee6a6' : 'rgba(255,255,255,0.08)' , 'fill-opacity': v ? 0.9 : 1 }, [s('title', {}, [document.createTextNode(short(d) + ': ' + v)])]);
    });
    return s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'master__bars', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, kids);
  }

  function render(clients, bookings) {
    root.innerHTML = '';
    var dates = []; for (var i = DAYS - 1; i >= 0; i--) dates.push(dayKey(i));
    var since = dates[0], until = dates[dates.length - 1], prevSince = dayKey(DAYS * 2 - 1), prevUntil = dayKey(DAYS);
    var byClient = {};
    bookings.forEach(function (b) {
      if (!b.clientKey) return;
      var o = byClient[b.clientKey] = byClient[b.clientKey] || { byDate: {}, cur: 0, prev: 0, label: b.label || 'Bookings', allTime: 0, last: '' };
      b.entries.forEach(function (e) {
        o.allTime += e.count || 0;
        if (e.date > o.last) o.last = e.date;
        if (e.date >= since && e.date <= until) { o.cur += e.count || 0; o.byDate[e.date] = (o.byDate[e.date] || 0) + (e.count || 0); }
        else if (e.date >= prevSince && e.date <= prevUntil) o.prev += e.count || 0;
      });
    });
    var list = clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });
    var total = 0; list.forEach(function (c) { total += (byClient[c.id] || {}).cur || 0; });
    root.appendChild(h('div', { 'class': 'perf-toolbar' }, [
      h('div', {}, [h('h2', { 'class': 'card__title', text: 'Master stats', style: 'margin:0' }), h('p', { 'class': 'muted mono', style: 'margin:4px 0 0; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px', text: 'Bookings per client · last ' + DAYS + ' days · ' + short(since) + ' – ' + short(until) + ' · ' + list.length + ' client' + (list.length === 1 ? '' : 's') + ' · ' + total + ' booking' + (total === 1 ? '' : 's') + ' in total' })])
    ]));
    if (!list.length) {
      root.appendChild(h('div', { 'class': 'card perf-empty' }, [h('h3', { text: 'No clients yet' }), h('p', { 'class': 'muted', text: 'Create clients with the Clients button on the Campaigns tab, then log their bookings in the Bookings row there. They appear here alphabetically.' })]));
      return;
    }
    var grid = h('div', { 'class': 'master__grid' });
    list.forEach(function (c) {
      var o = byClient[c.id] || { byDate: {}, cur: 0, prev: 0, label: 'Bookings', allTime: 0, last: '' };
      var delta = o.prev ? (o.cur - o.prev) / o.prev : null;
      var deltaEl = delta == null ? h('span', { 'class': 'master__delta master__delta--none', text: o.prev || o.cur ? 'nothing in the ' + DAYS + ' days before' : 'no bookings logged' })
        : h('span', { 'class': 'master__delta ' + (delta >= 0 ? 'is-up' : 'is-down'), text: (delta >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(delta)) + ' vs the ' + DAYS + ' days before (' + o.prev + ')' });
      grid.appendChild(h('div', { 'class': 'card master__cell' + (o.cur ? '' : ' is-empty') }, [
        h('div', { 'class': 'master__name', text: c.name }),
        h('div', { 'class': 'master__num', text: String(o.cur) }),
        h('div', { 'class': 'master__label mono', text: o.label.toUpperCase() + ' · LAST ' + DAYS + ' DAYS' }),
        deltaEl,
        bars(o.byDate, dates),
        h('div', { 'class': 'master__foot mono', text: (c.accounts.length ? c.accounts.length + ' ad account' + (c.accounts.length === 1 ? '' : 's') : 'no ad accounts') + ' · ' + o.allTime + ' all time' + (o.last ? ' · last ' + short(o.last) : '') })
      ]));
    });
    root.appendChild(grid);
  }

  var loading = false;
  function load() {
    if (loading) return; loading = true;
    Promise.all([request('/api/clients'), request('/api/bookings')]).then(function (r) { render(r[0] || [], r[1] || []); }, function (err) {
      root.innerHTML = ''; root.appendChild(h('div', { 'class': 'notice notice--error' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Could not load: ' + err.message })]));
    }).then(function () { loading = false; });
  }
  root.appendChild(h('p', { 'class': 'muted', text: 'Loading…' }));
  function maybe() { if (location.hash === '#master-stats') load(); }
  window.addEventListener('hashchange', maybe);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) maybe(); });
  load();
})();
