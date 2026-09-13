// Campaigns tab: hand-picked Meta campaigns, their numbers (pushed in by Hermes), and the refresh controls.
(function () {
  var root = document.getElementById('campaignsPage');
  if (!root) return;

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'value') node.value = attrs[k];
      else if (k === 'checked') node.checked = !!attrs[k];
      else if (k === 'disabled') node.disabled = !!attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  var SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, children) {
    var node = document.createElementNS(SVG, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') node.textContent = attrs[k]; else node.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function request(method, url, data) {
    return fetch(url, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined })
      .then(function (res) { return res.text().then(function (t) { var b; try { b = t ? JSON.parse(t) : {}; } catch (e) { b = { error: t }; } if (!res.ok) throw new Error(b.error || ('HTTP ' + res.status)); return b; }); });
  }

  // ---- formatting ----
  var currency = 'AUD';
  function symbol() { return currency === 'USD' || currency === 'AUD' || currency === 'NZD' || currency === 'CAD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : currency + ' '; }
  function money(v, decimals) { if (v == null || !isFinite(v)) return '–'; var neg = v < 0; var abs = Math.abs(v); return (neg ? '-' : '') + symbol() + abs.toLocaleString('en-AU', { minimumFractionDigits: decimals == null ? 2 : decimals, maximumFractionDigits: decimals == null ? 2 : decimals }); }
  function count(v) { return v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-AU'); }
  function pct(v) { return v == null || !isFinite(v) ? '–' : (v * 100).toLocaleString('en-AU', { maximumFractionDigits: 2 }) + '%'; }
  function ratio(v) { return v == null || !isFinite(v) ? '–' : v.toLocaleString('en-AU', { maximumFractionDigits: 2 }); }
  function compact(v) { var a = Math.abs(v); var t = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : a >= 100 ? a.toFixed(0) : a.toFixed(a >= 10 ? 0 : 1); return (v < 0 ? '-' : '') + t.replace(/\.0(?=[KM]?$)/, ''); }
  function div(a, b) { return b ? a / b : null; }
  function dateLabel(d) { var p = d.split('-'); return ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(p[1]) - 1] + ' ' + Number(p[2]); }
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'; }
  function ago(ts) { if (!ts) return 'never'; var m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }

  // ---- numbers ----
  var KEYS = ['spend', 'revenue', 'purchases', 'leads', 'newLeads', 'clicks', 'impressions', 'reach', 'calls', 'refunds', 'refundAmount'];
  function derive(m) {
    m = m || {};
    var out = Object.assign({}, m);
    out.profit = (m.revenue || 0) - (m.spend || 0);
    out.roas = div(m.revenue, m.spend);
    out.roi = m.spend ? (out.profit / m.spend) : null;
    out.ctr = div(m.clicks, m.impressions);
    out.cpc = div(m.spend, m.clicks);
    out.cpm = m.impressions ? (m.spend / m.impressions) * 1000 : null;
    out.cpl = div(m.spend, m.leads);
    out.cpnl = div(m.spend, m.newLeads);
    out.costPerSale = div(m.spend, m.purchases);
    return out;
  }
  function sum(list) { var out = {}; list.forEach(function (m) { KEYS.forEach(function (k) { if (m && m[k] != null) out[k] = (out[k] || 0) + m[k]; }); }); return out; }
  function dayKey(offset) { return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10); }
  // Aligns every campaign's daily numbers on the same 30 day window (and the 30 before it, for the change).
  function series(tracked) {
    var dates = [], prev = [];
    for (var i = 29; i >= 0; i--) dates.push(dayKey(i));
    for (var j = 59; j >= 30; j--) prev.push(dayKey(j));
    var byDate = {};
    var anyDaily = false;
    tracked.forEach(function (t) {
      ((t.stats && t.stats.daily) || []).forEach(function (d) { anyDaily = true; byDate[d.date] = byDate[d.date] || []; byDate[d.date].push(d); });
    });
    function rows(list) { return list.map(function (d) { return Object.assign({ date: d }, sum(byDate[d] || [])); }); }
    var cur = rows(dates), before = rows(prev);
    var hasPrev = before.some(function (r) { return Object.keys(r).length > 1; });
    var current = anyDaily ? sum(cur) : sum(tracked.map(function (t) { return t.stats && t.stats.metrics; }));
    return { dates: dates, rows: cur, current: derive(current), previous: hasPrev ? derive(sum(before)) : null, anyDaily: anyDaily };
  }
  function delta(cur, prev, key) { if (!prev || !prev[key]) return null; return (cur[key] - prev[key]) / Math.abs(prev[key]); }

  // ---- charts (inline SVG, hover crosshair + tooltip) ----
  function chart(rows, lines, opts) {
    opts = opts || {};
    var W = 340, H = opts.height || 210, padL = 40, padR = 8, padT = 10, padB = 24;
    var n = rows.length;
    var max = 0; lines.forEach(function (l) { rows.forEach(function (r) { max = Math.max(max, r[l.key] || 0); }); });
    if (!max) max = 1;
    var nice = Math.pow(10, Math.floor(Math.log10(max))); var top = Math.ceil(max / nice) * nice; if (top / max > 1.6) top = Math.ceil(max / (nice / 2)) * (nice / 2);
    var x = function (i) { return padL + (n > 1 ? (W - padL - padR) * i / (n - 1) : 0); };
    var y = function (v) { return padT + (H - padT - padB) * (1 - (v || 0) / top); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart', role: 'img', 'aria-label': opts.label || 'chart' });
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = top * t / ticks, yy = y(v);
      svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, 'class': 'chart__grid' }));
      svg.appendChild(s('text', { x: padL - 6, y: yy + 3, 'class': 'chart__tick', 'text-anchor': 'end', text: (opts.money ? symbol() : '') + compact(v) }));
    }
    var labelEvery = Math.max(1, Math.ceil(n / 5));
    rows.forEach(function (r, i) { if (i % labelEvery === 0) svg.appendChild(s('text', { x: x(i), y: H - 8, 'class': 'chart__tick', 'text-anchor': i === 0 ? 'start' : 'middle', text: dateLabel(r.date) })); });
    lines.forEach(function (l, li) {
      var pts = rows.map(function (r, i) { return x(i).toFixed(1) + ',' + y(r[l.key]).toFixed(1); });
      if (l.area) {
        var gid = 'g' + Math.random().toString(36).slice(2, 8);
        var defs = s('defs', {}, [s('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, [s('stop', { offset: '0%', 'stop-color': l.color, 'stop-opacity': 0.35 }), s('stop', { offset: '100%', 'stop-color': l.color, 'stop-opacity': 0.02 })])]);
        svg.appendChild(defs);
        svg.appendChild(s('path', { d: 'M' + pts.join(' L') + ' L' + x(n - 1).toFixed(1) + ',' + y(0) + ' L' + x(0).toFixed(1) + ',' + y(0) + ' Z', fill: 'url(#' + gid + ')' }));
      }
      svg.appendChild(s('path', { d: 'M' + pts.join(' L'), fill: 'none', stroke: l.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });
    // hover layer
    var cross = s('line', { y1: padT, y2: H - padB, 'class': 'chart__cross', visibility: 'hidden' });
    var dots = lines.map(function (l) { return s('circle', { r: 4, fill: l.color, stroke: '#2a2a2a', 'stroke-width': 2, visibility: 'hidden' }); });
    svg.appendChild(cross); dots.forEach(function (d) { svg.appendChild(d); });
    var wrap = h('div', { 'class': 'chart__wrap' }, [svg]);
    var tip = h('div', { 'class': 'chart__tip', hidden: '' }); wrap.appendChild(tip);
    var hit = s('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent' });
    svg.appendChild(hit);
    function show(evt) {
      var box = svg.getBoundingClientRect();
      var px = (evt.clientX - box.left) / box.width * W;
      var i = Math.max(0, Math.min(n - 1, Math.round((px - padL) / ((W - padL - padR) / Math.max(1, n - 1)))));
      var r = rows[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      lines.forEach(function (l, li) { dots[li].setAttribute('cx', x(i)); dots[li].setAttribute('cy', y(r[l.key])); dots[li].setAttribute('visibility', 'visible'); });
      tip.innerHTML = '';
      tip.appendChild(h('div', { 'class': 'chart__tipdate', text: dateLabel(r.date) }));
      lines.forEach(function (l) { tip.appendChild(h('div', { 'class': 'chart__tiprow' }, [h('span', { 'class': 'chart__swatch', style: 'background:' + l.color }), h('span', { text: l.name }), h('b', { text: l.money ? money(r[l.key] || 0) : count(r[l.key] || 0) })])); });
      tip.hidden = false;
      var left = x(i) / W * box.width; tip.style.left = Math.min(box.width - 140, Math.max(0, left + 10)) + 'px';
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); tip.hidden = true; }
    hit.addEventListener('mousemove', show); hit.addEventListener('mouseleave', hide);
    hit.addEventListener('touchstart', function (e) { if (e.touches[0]) show(e.touches[0]); }, { passive: true });
    if (lines.length > 1) wrap.appendChild(h('div', { 'class': 'chart__legend' }, lines.map(function (l) { return h('span', {}, [h('span', { 'class': 'chart__swatch', style: 'background:' + l.color }), l.name]); })));
    return wrap;
  }
  function spark(daily, key, color) {
    var W = 120, H = 32, n = daily.length;
    if (n < 2) return h('span', { 'class': 'muted', text: '–' });
    var max = Math.max.apply(null, daily.map(function (d) { return d[key] || 0; })) || 1;
    var pts = daily.map(function (d, i) { return (W * i / (n - 1)).toFixed(1) + ',' + (H - 2 - (H - 4) * (d[key] || 0) / max).toFixed(1); });
    return s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'spark', 'aria-hidden': 'true' }, [s('path', { d: 'M' + pts.join(' L'), fill: 'none', stroke: color, 'stroke-width': 1.5 })]);
  }

  // ---- cards ----
  function icon(txt) { return h('span', { 'class': 'perf__icon', text: txt }); }
  function cardHead(title, ic) { return h('div', { 'class': 'perf__head' }, [icon(ic), h('span', { 'class': 'perf__title', text: title })]); }
  function big(value, label, cls) { return h('div', { 'class': 'perf__big' }, [h('div', { 'class': 'perf__value ' + (cls || ''), text: value }), label ? h('div', { 'class': 'perf__label', text: label }) : null]); }
  function cell(value, label, cls) { return h('div', { 'class': 'perf__cell' }, [h('div', { 'class': 'perf__num ' + (cls || ''), text: value }), h('div', { 'class': 'perf__label', text: label })]); }
  function block(children, cls) { return h('div', { 'class': 'perf__block ' + (cls || '') }, children); }
  function deltaTag(v) {
    if (v == null) return null;
    return h('span', { 'class': 'perf__delta ' + (v >= 0 ? 'is-up' : 'is-down'), text: (v >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(v)) });
  }
  function summaryCards(sr) {
    var c = sr.current, p = sr.previous;
    var GREY = '#d9d9d9', RED = '#e5534b', BLUE = '#7aa7ff';
    var revenue = h('div', { 'class': 'card perf perf--revenue' }, [
      cardHead('Total Revenue', '↗'),
      block([h('div', { 'class': 'perf__hero' }, [h('span', { 'class': 'perf__value', text: money(c.revenue || 0) }), deltaTag(delta(c, p, 'revenue'))]), h('div', { 'class': 'perf__sub', text: 'Cost: ' + money(c.spend || 0) })]),
      sr.anyDaily ? chart(sr.rows, [{ key: 'revenue', name: 'Revenue', color: GREY, area: true, money: true }], { money: true, label: 'Daily revenue, last 30 days' }) : h('p', { 'class': 'muted perf__nodaily', text: 'Daily numbers appear after the next refresh.' })
    ]);
    var totals = h('div', { 'class': 'card perf perf--totals' }, [
      cardHead('Total Stats', '▤'),
      block([big(money(c.profit), 'Profit', c.profit < 0 ? 'is-neg' : '')]),
      block([h('div', { 'class': 'perf__grid' }, [cell(ratio(c.roas), 'ROAS'), cell(money(c.spend || 0), 'Cost'), cell(count(c.clicks), 'Clicks'), cell(money(c.costPerSale), 'Cost per sale'), cell(count(c.purchases), 'Sales'), cell(money(c.cpl), 'Cost per lead')])])
    ]);
    var fb = h('div', { 'class': 'card perf perf--fb' }, [
      cardHead('Facebook Stats', 'f'),
      block([h('div', { 'class': 'perf__grid' }, [cell(money(c.profit), 'Profit', c.profit < 0 ? 'is-neg' : ''), cell(count(c.purchases), 'Sales')])], 'perf__block--top'),
      block([h('div', { 'class': 'perf__grid' }, [cell(money(c.spend || 0), 'Spend'), cell(money(c.revenue || 0), 'Total revenue', 'is-pos'), cell(pct(c.roi), 'ROI', c.roi != null && c.roi < 0 ? 'is-neg' : ''), cell(ratio(c.roas), 'ROAS')])]),
      block([h('div', { 'class': 'perf__grid' }, [cell(count(c.leads), 'Leads'), cell(count(c.newLeads), 'New leads'), cell(count(c.clicks), 'Clicks'), cell(count(c.calls), 'Calls')])]),
      block([h('div', { 'class': 'perf__grid' }, [cell(count(c.impressions), 'Impressions'), cell(count(c.reach), 'Reach'), cell(count(c.refunds), 'Refund count'), cell(money(c.refundAmount), 'Refund')])]),
      block([h('div', { 'class': 'perf__grid' }, [cell(money(c.cpnl), 'Cost per new lead'), cell(money(c.cpl), 'Cost per lead'), cell(money(c.costPerSale), 'Cost per sale'), cell(money(c.cpc), 'Cost per click'), cell(pct(c.ctr), 'CTR'), cell(money(c.cpm), 'CPM')])])
    ]);
    var rc = h('div', { 'class': 'card perf perf--rc' }, [
      cardHead('Facebook Revenue/Cost', 'f'),
      block([h('div', { 'class': 'perf__grid' }, [cell(money(c.revenue || 0, 0), 'Revenue'), cell(money(c.spend || 0, 0), 'Cost')])]),
      sr.anyDaily ? chart(sr.rows, [{ key: 'revenue', name: 'Revenue', color: GREY, area: true, money: true }, { key: 'spend', name: 'Cost', color: RED, money: true }], { money: true, label: 'Revenue and cost per day, last 30 days' }) : h('p', { 'class': 'muted perf__nodaily', text: 'Daily numbers appear after the next refresh.' })
    ]);
    var leads = h('div', { 'class': 'card perf perf--leads' }, [
      cardHead('Total Leads', '◔'),
      block([h('div', { 'class': 'perf__grid' }, [cell(money(c.cpl), 'Cost per lead'), cell(count(c.leads), 'Total leads')])]),
      sr.anyDaily ? chart(sr.rows, [{ key: 'leads', name: 'Leads', color: BLUE, area: true }], { label: 'Leads per day, last 30 days' }) : h('p', { 'class': 'muted perf__nodaily', text: 'Daily numbers appear after the next refresh.' })
    ]);
    return h('div', { 'class': 'perf-grid' }, [revenue, fb, rc, totals, leads]);
  }

  // ---- campaign rows ----
  function statusBadge(st) {
    var t = String(st || '').toUpperCase();
    var cls = t === 'ACTIVE' ? 'badge--live' : t === 'PAUSED' || t === 'CAMPAIGN_PAUSED' || t === 'ADSET_PAUSED' ? 'badge--paused' : 'badge--draft';
    return h('span', { 'class': 'badge ' + cls, text: t ? t.replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) : 'Unknown' });
  }
  function rowMetric(value, label, cls) { return h('div', { 'class': 'crow__metric' }, [h('div', { 'class': 'crow__num ' + (cls || ''), text: value }), h('div', { 'class': 'crow__label', text: label })]); }
  function campaignRow(t) {
    var st = t.stats;
    var daily = (st && st.daily) || [];
    var last30 = daily.filter(function (d) { return d.date >= dayKey(29); });
    var m = st ? derive(last30.length ? sum(last30) : st.metrics || {}) : {};
    var none = !st;
    var remove = h('button', { 'class': 'crow__remove', title: 'Stop tracking this campaign', type: 'button', onclick: function () {
      request('DELETE', '/api/tracked/' + t.id).then(function (o) { apply(o); }, function (err) { setNotice('error', err.message); });
    } }, ['×']);
    return h('div', { 'class': 'card crow' }, [
      h('div', { 'class': 'crow__id' }, [
        h('div', { 'class': 'crow__name', text: t.name }),
        h('div', { 'class': 'crow__meta' }, [statusBadge(t.status), h('span', { text: (t.adAccountName || t.adAccountId || '') }), h('span', { 'class': 'crow__cid', text: 'ID ' + t.id })])
      ]),
      h('div', { 'class': 'crow__metrics' }, [
        rowMetric(none ? '–' : money(m.spend || 0, 0), 'Spend'), rowMetric(none ? '–' : money(m.revenue || 0, 0), 'Revenue', (m.revenue || 0) > 0 ? 'is-pos' : ''), rowMetric(none ? '–' : money(m.profit, 0), 'Profit', m.profit < 0 ? 'is-neg' : ''), rowMetric(money(m.costPerSale, 0), 'Cost / sale'),
        rowMetric(ratio(m.roas), 'ROAS'), rowMetric(count(m.purchases), 'Sales'), rowMetric(count(m.leads), 'Leads'), rowMetric(money(m.cpl), 'CPL'),
        rowMetric(count(m.clicks), 'Clicks'), rowMetric(pct(m.ctr), 'CTR'), rowMetric(money(m.cpc), 'CPC')
      ]),
      h('div', { 'class': 'crow__spark' }, [spark(last30, 'spend', '#e5534b'), h('div', { 'class': 'crow__label', text: st ? 'Spend, 30 d · synced ' + ago(st.syncedAt) : 'No data yet' })]),
      remove
    ]);
  }

  // ---- picker: 1) ad accounts -> 2) Hermes pulls their campaigns -> 3) tick what shows on the dashboard ----
  function waitFor(check, onDone, onGiveUp, everyMs, maxTries) {
    var tries = 0;
    (function tick() {
      setTimeout(function () {
        tries++;
        request('GET', '/api/tracked').then(function (o) {
          data = o;
          if (check(o)) return onDone(o);
          if (tries < maxTries) tick(); else onGiveUp(o);
        }, function () { if (tries < maxTries) tick(); else onGiveUp(data); });
      }, everyMs);
    })();
  }
  function openPicker() {
    var chosenAccounts = {}; data.tracked.forEach(function (t) { if (t.adAccountId) chosenAccounts[t.adAccountId] = true; });
    var chosen = {}; data.tracked.forEach(function (t) { chosen[t.id] = t; });
    var step = 1, requestedAt = 0, waiting = false;
    var panel = h('div', { 'class': 'picker__panel picker__panel--wide' });
    var overlay = h('div', { 'class': 'picker' }, [panel]);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    var status = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
    function say(kind, text) { status.hidden = !text; status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = text || ''; }
    function head() {
      return h('div', { 'class': 'picker__head' }, [
        h('div', {}, [h('h2', { 'class': 'card__title', text: 'Choose campaigns', style: 'margin:0' }),
          h('div', { 'class': 'steps' }, [1, 2, 3].map(function (n) { return h('span', { 'class': 'steps__item' + (n === step ? ' is-on' : n < step ? ' is-done' : ''), text: n + ' ' + ['Ad accounts', 'Campaigns', 'Dashboard'][n - 1] }); }))]),
        h('button', { 'class': 'btn', type: 'button', onclick: function () { overlay.remove(); } }, ['Close'])
      ]);
    }
    function draw() { panel.innerHTML = ''; panel.appendChild(head()); panel.appendChild(status); (step === 1 ? drawAccounts : drawCampaigns)(); }

    // Step 1: which ad accounts
    function drawAccounts() {
      var accounts = data.accounts || [];
      panel.appendChild(h('p', { 'class': 'muted', text: 'Which ad accounts do you want to pull campaigns from? Hermes lists the campaigns of the ticked accounts only.' }));
      var list = h('div', { 'class': 'picker__list' });
      var boxes = [];
      function countSel() { return Object.keys(chosenAccounts).filter(function (k) { return chosenAccounts[k]; }).length; }
      var allBox = h('input', { type: 'checkbox' });
      var allRow = h('label', { 'class': 'picker__item picker__item--all' }, [allBox, h('div', { 'class': 'picker__text' }, [h('strong', { text: 'Select all' }), h('span', { text: accounts.length + ' ad account' + (accounts.length === 1 ? '' : 's') })])]);
      allBox.addEventListener('change', function () { accounts.forEach(function (a) { chosenAccounts[a.id] = allBox.checked; }); boxes.forEach(function (b) { b.checked = allBox.checked; }); syncAll(); });
      function syncAll() { allBox.checked = accounts.length > 0 && accounts.every(function (a) { return chosenAccounts[a.id]; }); pull.disabled = !countSel() || waiting; pull.textContent = waiting ? 'Asking Hermes…' : 'Pull campaigns from ' + (countSel() || 'these') + ' account' + (countSel() === 1 ? '' : 's'); }
      if (accounts.length) list.appendChild(allRow);
      accounts.forEach(function (a) {
        var box = h('input', { type: 'checkbox', checked: !!chosenAccounts[a.id] });
        boxes.push(box);
        box.addEventListener('change', function () { chosenAccounts[a.id] = box.checked; syncAll(); });
        list.appendChild(h('label', { 'class': 'picker__item' }, [box, h('div', { 'class': 'picker__text' }, [h('strong', { text: a.name }), h('span', { text: a.id + (a.source === 'table' ? ' · from the Ad Accounts tab' : '') })])]));
      });
      if (!accounts.length) list.appendChild(h('p', { 'class': 'muted', text: 'No ad accounts known yet. Ask Hermes for the list, or add the Ads Manager link (with act=…) to a row in the Ad Accounts tab.' }));
      panel.appendChild(list);
      var pull = h('button', { 'class': 'btn btn--primary', type: 'button', onclick: function () {
        var ids = accounts.filter(function (a) { return chosenAccounts[a.id]; }).map(function (a) { return a.id; });
        waiting = true; syncAll();
        request('POST', '/api/tracked/sync', { accounts: ids }).then(function (r) {
          requestedAt = r.sync.at; step = 2; draw();
          say('ok', 'Hermes accepted the request and started a run. Campaigns appear below as it sends them (usually within a minute or two); checking every 10 seconds.');
          waitFor(function (o) { return o.catalog.syncedAt && o.catalog.syncedAt > requestedAt; },
            function () { waiting = false; if (step === 2) { draw(); say('ok', 'Campaign list updated ' + when(data.catalog.syncedAt) + '.'); } },
            function () { waiting = false; if (step === 2) { draw(); say('error', 'Hermes has not sent any campaigns after 5 minutes. Check its reply in Slack and the gateway log: it needs the ADBUILDER_API_KEY and a toolset that can call Meta and make HTTP requests.'); } }, 10000, 30);
        }, function (err) { waiting = false; syncAll(); say('error', err.message); });
      } }, ['Pull campaigns']);
      var fetchAccounts = h('button', { 'class': 'btn', type: 'button', onclick: function () {
        fetchAccounts.disabled = true; fetchAccounts.textContent = 'Asking Hermes…';
        request('POST', '/api/tracked/sync', { accounts: [] }).then(function (r) {
          say('ok', 'Hermes accepted the request (HTTP ' + r.sync.status + '). Ad accounts appear here as it sends them; checking every 10 seconds.');
          var before = (data.accounts || []).length;
          waitFor(function (o) { return (o.accounts || []).length > before; },
            function () { if (step === 1) { draw(); say('ok', 'Ad accounts received.'); } },
            function () { fetchAccounts.disabled = false; fetchAccounts.textContent = 'Fetch ad accounts from Hermes'; say('', 'No ad accounts from Hermes yet. Check the Hermes gateway log.'); }, 10000, 30);
        }, function (err) { fetchAccounts.disabled = false; fetchAccounts.textContent = 'Fetch ad accounts from Hermes'; say('error', err.message); });
      } }, ['Fetch ad accounts from Hermes']);
      var skip = h('button', { 'class': 'btn', type: 'button', onclick: function () { step = 2; draw(); } }, ['Skip: use campaigns already synced']);
      panel.appendChild(h('div', { 'class': 'picker__foot' }, [h('div', { 'class': 'btn-row' }, [fetchAccounts, skip]), pull]));
      syncAll();
    }

    // Step 2: campaigns of the chosen accounts, tick to show on the dashboard
    function drawCampaigns() {
      var selectedAccounts = Object.keys(chosenAccounts).filter(function (k) { return chosenAccounts[k]; });
      var catalog = (data.catalog.items || []).filter(function (c) { return !selectedAccounts.length || !c.adAccountId || selectedAccounts.indexOf(c.adAccountId) !== -1; });
      var names = {}; (data.accounts || []).forEach(function (a) { names[a.id] = a.name; });
      panel.appendChild(h('p', { 'class': 'muted', text: 'Tick the campaigns to show on the dashboard. Only ticked campaigns are pulled from Meta (twice a day and on Refresh).' }));
      var search = h('input', { 'class': 'table__input', placeholder: 'Search campaigns…', type: 'search' });
      var list = h('div', { 'class': 'picker__list' });
      var countEl = h('span', { 'class': 'muted' });
      function selectedCount() { return Object.keys(chosen).length; }
      function drawList() {
        list.innerHTML = '';
        var q = search.value.trim().toLowerCase();
        var extra = Object.keys(chosen).filter(function (id) { return !catalog.some(function (c) { return c.id === id; }); }).map(function (id) { return chosen[id]; });
        var groups = {};
        catalog.concat(extra).forEach(function (c) {
          if (q && (c.name + ' ' + c.id + ' ' + (c.adAccountName || '')).toLowerCase().indexOf(q) === -1) return;
          var g = c.adAccountName || names[c.adAccountId] || c.adAccountId || 'Other';
          (groups[g] = groups[g] || []).push(c);
        });
        Object.keys(groups).sort().forEach(function (g) {
          var items = groups[g];
          var allBox = h('input', { type: 'checkbox', checked: items.every(function (c) { return !!chosen[c.id]; }) });
          var groupRow = h('label', { 'class': 'picker__group picker__group--row' }, [allBox, h('span', { text: g + ' · ' + items.length })]);
          allBox.addEventListener('change', function () { items.forEach(function (c) { if (allBox.checked) chosen[c.id] = c; else delete chosen[c.id]; }); drawList(); });
          list.appendChild(groupRow);
          items.sort(function (a, b) { return (a.status === 'ACTIVE' ? 0 : 1) - (b.status === 'ACTIVE' ? 0 : 1) || a.name.localeCompare(b.name); }).forEach(function (c) {
            var box = h('input', { type: 'checkbox', checked: !!chosen[c.id] });
            var item = h('label', { 'class': 'picker__item' + (chosen[c.id] ? ' is-added' : '') }, [box,
              h('div', { 'class': 'picker__text' }, [h('strong', { text: c.name }), h('span', { text: 'ID ' + c.id + (c.status ? ' · ' + c.status : '') + (c.objective ? ' · ' + c.objective : '') })]),
              h('span', { 'class': 'picker__show', text: chosen[c.id] ? 'On dashboard' : 'Show on dashboard' })]);
            box.addEventListener('change', function () { if (box.checked) chosen[c.id] = c; else delete chosen[c.id]; item.classList.toggle('is-added', box.checked); item.lastChild.textContent = box.checked ? 'On dashboard' : 'Show on dashboard'; countEl.textContent = selectedCount() + ' on dashboard'; });
            list.appendChild(item);
          });
        });
        if (!list.children.length) list.appendChild(h('p', { 'class': 'muted', text: waiting ? 'Waiting for Hermes to send the campaign list…' : catalog.length ? 'Nothing matches.' : 'No campaigns synced for these accounts yet. Go back and press "Pull campaigns", or add one by ID below.' }));
        countEl.textContent = selectedCount() + ' on dashboard';
      }
      search.addEventListener('input', drawList);
      var manualId = h('input', { 'class': 'table__input', placeholder: 'Campaign ID (numbers only)', inputmode: 'numeric' });
      var manualName = h('input', { 'class': 'table__input', placeholder: 'Name' });
      var manualAdd = h('button', { 'class': 'btn', type: 'button', onclick: function () {
        var id = manualId.value.replace(/\D/g, '');
        if (!/^\d{5,30}$/.test(id)) { manualId.focus(); return; }
        chosen[id] = { id: id, name: manualName.value.trim() || 'Campaign ' + id, adAccountId: selectedAccounts.length === 1 ? selectedAccounts[0] : '' };
        manualId.value = ''; manualName.value = ''; drawList();
      } }, ['Add by ID']);
      var back = h('button', { 'class': 'btn', type: 'button', onclick: function () { step = 1; draw(); } }, ['Back']);
      var save = h('button', { 'class': 'btn btn--primary', type: 'button', onclick: function () {
        save.disabled = true;
        request('PUT', '/api/tracked', { campaigns: Object.keys(chosen).map(function (id) { return chosen[id]; }) })
          .then(function (o) { overlay.remove(); apply(o); setNotice('ok', o.tracked.length + ' campaign' + (o.tracked.length === 1 ? '' : 's') + ' on the dashboard. Press Refresh to pull their numbers now.'); }, function (err) { save.disabled = false; say('error', err.message); });
      } }, ['Save to dashboard']);
      panel.appendChild(search); panel.appendChild(list);
      panel.appendChild(h('div', { 'class': 'picker__manual' }, [manualId, manualName, manualAdd]));
      panel.appendChild(h('div', { 'class': 'picker__foot' }, [h('div', { 'class': 'btn-row' }, [back, countEl]), save]));
      drawList();
    }
    document.body.appendChild(overlay);
    draw();
  }

  // ---- page ----
  var data = null, notice = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
  function setNotice(kind, text) { notice.hidden = !text; notice.className = 'notice' + (kind ? ' notice--' + kind : ''); notice.lastChild.textContent = text || ''; }
  var body = h('div', {});
  var refreshBtn = h('button', { 'class': 'btn btn--primary', type: 'button', onclick: doRefresh }, ['Refresh']);
  var chooseBtn = h('button', { 'class': 'btn', type: 'button', onclick: function () { if (data) openPicker(); } }, ['Choose campaigns']);
  var subtitle = h('div', { 'class': 'muted' });
  root.appendChild(h('div', { 'class': 'perf-toolbar' }, [h('div', {}, [h('h2', { 'class': 'card__title', text: 'Current campaigns', style: 'margin:0' }), subtitle]), h('div', { 'class': 'btn-row' }, [chooseBtn, refreshBtn])]));
  root.appendChild(notice);
  root.appendChild(body);

  function apply(o) { data = o; render(); }
  function render() {
    var d = data;
    body.innerHTML = '';
    var cur = d.tracked.filter(function (t) { return t.stats && t.stats.currency; })[0];
    if (cur) currency = cur.stats.currency;
    var next = new Date(d.schedule.nextAt);
    subtitle.textContent = d.tracked.length + ' tracked · data ' + (d.lastDataAt ? 'from ' + when(d.lastDataAt) : 'not received yet') + ' · next pull ' + next.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' Adelaide' + (d.cronConfigured ? '' : ' (CRON_SECRET not set: scheduled pulls are off)');
    refreshBtn.disabled = !d.tracked.length;
    if (!d.tracked.length) {
      body.appendChild(h('div', { 'class': 'card perf-empty' }, [
        h('h3', { text: 'No campaigns tracked yet' }),
        h('p', { 'class': 'muted', text: 'Press "Choose campaigns", then Refresh. Hermes pulls only the chosen campaigns, at 8:00 and 15:00 Adelaide time and whenever you press Refresh.' }),
        h('p', { 'class': 'muted', text: 'Step 1 picks the ad accounts, step 2 asks Hermes for their campaign list, step 3 ticks what shows here.' })
      ]));
      return;
    }
    var sr = series(d.tracked);
    body.appendChild(summaryCards(sr));
    body.appendChild(h('div', { 'class': 'crow-head' }, [h('span', { text: 'Campaigns' }), h('span', { 'class': 'muted', text: 'Last 30 days · ' + (d.pending ? 'waiting for Hermes to send new numbers…' : 'numbers as sent by Hermes') })]));
    d.tracked.forEach(function (t) { body.appendChild(campaignRow(t)); });
  }
  function load() { return request('GET', '/api/tracked').then(apply, function (err) { setNotice('error', 'Could not load: ' + err.message); }); }
  var pollTimer = null;
  function pollForData(startedAt) {
    clearTimeout(pollTimer);
    var tries = 0;
    (function tick() {
      pollTimer = setTimeout(function () {
        tries++;
        request('GET', '/api/tracked').then(function (o) {
          if (o.lastDataAt && o.lastDataAt > startedAt) { apply(o); setNotice('ok', 'Hermes sent new numbers at ' + when(o.lastDataAt) + '.'); return; }
          if (tries < 30) tick(); else setNotice('', 'No numbers from Hermes yet. They will show here as soon as it sends them.');
        }, function () { if (tries < 30) tick(); });
      }, 20000);
    })();
  }
  function doRefresh() {
    refreshBtn.disabled = true; refreshBtn.textContent = 'Asking Hermes…';
    request('POST', '/api/tracked/refresh').then(function (r) {
      setNotice('ok', 'Hermes accepted the request (HTTP ' + r.refresh.status + ') for ' + r.refresh.campaigns + ' campaign' + (r.refresh.campaigns === 1 ? '' : 's') + '. Numbers appear here once it has pulled them; this page checks every 20 seconds.');
      pollForData(r.refresh.at);
      return load();
    }, function (err) { setNotice('error', err.message); })
      .then(function () { refreshBtn.disabled = false; refreshBtn.textContent = 'Refresh'; });
  }
  load();
  document.addEventListener('visibilitychange', function () { if (!document.hidden && location.hash === '#campaigns') load(); });
  window.addEventListener('hashchange', function () { if (location.hash === '#campaigns') load(); });
})();
