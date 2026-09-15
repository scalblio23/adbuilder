// Master stats: a spreadsheet of bookings per client. Rows are the clients from the Clients manager on the
// Campaigns tab (alphabetical), columns are the last 30 days, plus a total column and a totals row. Cells are
// editable: type a count and press Enter (or click away) to log it. Data: /api/clients, /api/bookings.
(function () {
  var root = document.getElementById('masterPage');
  if (!root) return;
  var DAYS = 30;
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') node.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]); else if (k === 'value') node.value = attrs[k]; else node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function request(method, url, data) {
    return fetch(url, { method: method, cache: 'no-store', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined })
      .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status); return b; }); });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayKey(offset) { var d = new Date(); d.setDate(d.getDate() - offset); return iso(d); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  function short(k) { var p = k.split('-'); return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1]; }
  function weekday(k) { return WD[new Date(k + 'T12:00:00').getDay()]; }

  var clients = [], bookings = [], status;
  function say(kind, text) { if (!status) return; status.hidden = !text; status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = text || ''; }
  // the bookings doc a client's cells write to: its existing one (most entries), else a new one keyed by the client
  function docFor(c) {
    var mine = bookings.filter(function (b) { return b.clientKey === c.id; }).sort(function (a, b) { return b.entries.length - a.entries.length; });
    return mine[0] || { accountId: c.id, client: c.name, label: 'Bookings', entries: [], isNew: true };
  }
  function countsFor(c) {
    var byDate = {}; bookings.forEach(function (b) { if (b.clientKey === c.id) b.entries.forEach(function (e) { byDate[e.date] = (byDate[e.date] || 0) + (e.count || 0); }); });
    return byDate;
  }
  // Set the count for one client on one day. Other docs for the same client on that day are folded into the main doc.
  function setCount(c, date, count) {
    var main = docFor(c), others = bookings.filter(function (b) { return b.clientKey === c.id && b.accountId !== main.accountId && b.entries.some(function (e) { return e.date === date; }); });
    var entries = main.entries.filter(function (e) { return e.date !== date; }).map(function (e) { return { date: e.date, count: e.count }; });
    if (count > 0) entries.push({ date: date, count: count });
    var body = { entries: entries };
    if (main.isNew) { body.client = c.name; body.label = 'Bookings'; }
    return request('PUT', '/api/bookings/' + encodeURIComponent(main.accountId), body).then(function () {
      return others.reduce(function (chain, o) { return chain.then(function () { return request('PUT', '/api/bookings/' + encodeURIComponent(o.accountId), { entries: o.entries.filter(function (e) { return e.date !== date; }) }); }); }, Promise.resolve());
    }).then(function () { return request('GET', '/api/bookings'); }).then(function (list) { bookings = list; });
  }

  function render() {
    root.innerHTML = '';
    var dates = []; for (var i = DAYS - 1; i >= 0; i--) dates.push(dayKey(i));
    var today = dates[dates.length - 1];
    var list = clients.slice().sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); });
    status = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
    var colTotals = {}, grand = 0;
    var rows = list.map(function (c) {
      var byDate = countsFor(c), total = 0;
      dates.forEach(function (d) { var v = byDate[d] || 0; total += v; colTotals[d] = (colTotals[d] || 0) + v; });
      grand += total;
      return { c: c, byDate: byDate, total: total };
    });
    root.appendChild(h('div', { 'class': 'perf-toolbar' }, [
      h('div', {}, [h('h2', { 'class': 'card__title', text: 'Master stats', style: 'margin:0' }), h('p', { 'class': 'muted mono', style: 'margin:4px 0 0; text-transform: uppercase; letter-spacing: 0.08em; font-size: 11px', text: 'Bookings per client per day · last ' + DAYS + ' days · ' + short(dates[0]) + ' – ' + short(today) + ' · ' + list.length + ' client' + (list.length === 1 ? '' : 's') + ' · ' + grand + ' booking' + (grand === 1 ? '' : 's') })]),
      h('div', { 'class': 'muted', style: 'font-size:12px', text: 'Click a cell, type a number, press Enter. Clients come from the Clients button on the Campaigns tab.' })
    ]));
    root.appendChild(status);
    if (!list.length) {
      root.appendChild(h('div', { 'class': 'card perf-empty' }, [h('h3', { text: 'No clients yet' }), h('p', { 'class': 'muted', text: 'Create clients with the Clients button on the Campaigns tab. They appear here as rows, alphabetically.' })]));
      return;
    }
    var thead = h('thead', {}, [h('tr', {}, [h('th', { 'class': 'sheet__name sheet__corner', text: 'Client' })]
      .concat(dates.map(function (d) { return h('th', { 'class': 'sheet__day' + (d === today ? ' is-today' : '') + (/^S/.test(weekday(d)) ? ' is-weekend' : ''), title: d }, [h('span', { 'class': 'sheet__wd', text: weekday(d) }), h('span', { text: short(d) })]); }))
      .concat([h('th', { 'class': 'sheet__total', text: 'Total' })]))]);
    var tbody = h('tbody');
    rows.forEach(function (r) {
      var totalCell = h('td', { 'class': 'sheet__total', text: String(r.total) });
      var tr = h('tr', {}, [h('th', { 'class': 'sheet__name', scope: 'row', title: r.c.accounts.length + ' ad account' + (r.c.accounts.length === 1 ? '' : 's') }, [h('span', { text: r.c.name })])]);
      dates.forEach(function (d) {
        var v = r.byDate[d] || 0;
        var td = h('td', { 'class': 'sheet__cell' + (v ? ' has-value' : '') + (d === today ? ' is-today' : ''), tabindex: '0', title: r.c.name + ' · ' + short(d) }, [h('span', { text: v ? String(v) : '' })]);
        function edit() {
          if (td.querySelector('input')) return;
          var input = h('input', { 'class': 'sheet__input', type: 'number', min: '0', step: '1', value: v ? String(v) : '' });
          td.innerHTML = ''; td.appendChild(input); input.focus(); input.select();
          var done = false;
          function commit() {
            if (done) return; done = true;
            var n = Math.max(0, Math.round(Number(input.value) || 0));
            if (n === v) { td.innerHTML = ''; td.appendChild(h('span', { text: v ? String(v) : '' })); return; }
            td.classList.add('is-saving');
            setCount(r.c, d, n).then(function () { render(); say('ok', short(d) + ' · ' + r.c.name + ' set to ' + n + '.'); }, function (err) { render(); say('error', 'Could not save: ' + err.message); });
          }
          input.addEventListener('blur', commit);
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { done = true; td.innerHTML = ''; td.appendChild(h('span', { text: v ? String(v) : '' })); }
            else if (e.key === 'Tab') { /* let the browser move focus; blur commits */ }
          });
        }
        td.addEventListener('click', edit);
        td.addEventListener('keydown', function (e) { if (e.key === 'Enter' || (e.key.length === 1 && /[0-9]/.test(e.key))) { edit(); if (/[0-9]/.test(e.key)) { var inp = td.querySelector('input'); if (inp) { inp.value = e.key; e.preventDefault(); } } } });
        tr.appendChild(td);
      });
      tr.appendChild(totalCell);
      tbody.appendChild(tr);
    });
    var tfoot = h('tfoot', {}, [h('tr', {}, [h('th', { 'class': 'sheet__name', text: 'All clients' })]
      .concat(dates.map(function (d) { return h('td', { 'class': 'sheet__cell sheet__sum' + (d === today ? ' is-today' : ''), text: colTotals[d] ? String(colTotals[d]) : '' }); }))
      .concat([h('td', { 'class': 'sheet__total', text: String(grand) })]))]);
    root.appendChild(h('div', { 'class': 'sheet-wrap' }, [h('table', { 'class': 'sheet' }, [thead, tbody, tfoot])]));
    var wrap = root.querySelector('.sheet-wrap'); wrap.scrollLeft = wrap.scrollWidth;
  }

  var loading = false;
  function load() {
    if (loading) return; loading = true;
    Promise.all([request('GET', '/api/clients'), request('GET', '/api/bookings')]).then(function (r) { clients = r[0] || []; bookings = r[1] || []; render(); }, function (err) {
      root.innerHTML = ''; root.appendChild(h('div', { 'class': 'notice notice--error' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Could not load: ' + err.message })]));
    }).then(function () { loading = false; });
  }
  root.appendChild(h('p', { 'class': 'muted', text: 'Loading…' }));
  function maybe() { if (location.hash === '#master-stats' && !root.querySelector('.sheet__input')) load(); }
  window.addEventListener('hashchange', maybe);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) maybe(); });
  load();
})();
