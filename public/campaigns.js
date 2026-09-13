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
  var KEYS = ['spend', 'impressions', 'reach', 'clicksAll', 'linkClicks', 'results', 'revenue', 'purchases', 'leads', 'newLeads', 'calls'];
  function derive(m) {
    m = m || {};
    var out = Object.assign({}, m);
    var link = m.linkClicks != null ? m.linkClicks : null;
    var all = m.clicksAll != null ? m.clicksAll : null;
    out.cpm = m.impressions ? (m.spend || 0) / m.impressions * 1000 : null;
    out.cplc = link ? (m.spend || 0) / link : null;
    out.ctrAll = all != null && m.impressions ? all / m.impressions : null;
    out.linkCtr = link != null && m.impressions ? link / m.impressions : null;
    out.frequency = m.reach ? (m.impressions || 0) / m.reach : null;
    out.costPerResult = m.results ? (m.spend || 0) / m.results : null;
    out.profit = m.revenue != null ? m.revenue - (m.spend || 0) : null;
    out.roas = div(m.revenue, m.spend);
    out.cpl = div(m.spend, m.leads);
    out.costPerSale = div(m.spend, m.purchases);
    return out;
  }
  function sum(list) { var out = {}; list.forEach(function (m) { KEYS.forEach(function (k) { if (m && m[k] != null) out[k] = (out[k] || 0) + m[k]; }); }); return out; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayKey(offset) { var d = new Date(); d.setDate(d.getDate() - offset); return iso(d); }
  // ---- timeframe ----
  var PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['max', 'Maximum (60 days)'], ['custom', 'Custom…']];
  var frame = { preset: '7', since: '', until: '' };
  try { var savedFrame = JSON.parse(localStorage.getItem('adbuilder.timeframe') || 'null'); if (savedFrame && savedFrame.preset) frame = savedFrame; } catch (e) {}
  function rangeOf(f) {
    var now = new Date(), since, until = iso(now);
    if (f.preset === 'today') since = until;
    else if (f.preset === 'yesterday') { since = until = dayKey(1); }
    else if (f.preset === 'month') since = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    else if (f.preset === 'lastmonth') { since = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)); until = iso(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else if (f.preset === 'max') since = dayKey(59);
    else if (f.preset === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(f.since)) { since = f.since; until = /^\d{4}-\d{2}-\d{2}$/.test(f.until) ? f.until : until; }
    else since = dayKey(Number(f.preset || 7) - 1);
    if (since > until) { var t = since; since = until; until = t; }
    var dates = [], d = new Date(since + 'T00:00:00');
    while (iso(d) <= until && dates.length < 366) { dates.push(iso(d)); d.setDate(d.getDate() + 1); }
    var len = dates.length;
    var prevEnd = new Date(since + 'T00:00:00'); prevEnd.setDate(prevEnd.getDate() - 1);
    var prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - (len - 1));
    return { since: since, until: until, dates: dates, prevSince: iso(prevStart), prevUntil: iso(prevEnd), label: since === until ? dateLabel(since) : dateLabel(since) + ' – ' + dateLabel(until) };
  }
  function inRange(daily, since, until) { return (daily || []).filter(function (d) { return d.date >= since && d.date <= until; }); }
  // Totals for a set of daily rows over the current timeframe, aligned per date for the charts.
  function series(tracked, r) {
    var byDate = {}, anyDaily = false, prevRows = [];
    tracked.forEach(function (t) {
      ((t.stats && t.stats.daily) || []).forEach(function (d) {
        anyDaily = true;
        if (d.date >= r.since && d.date <= r.until) { (byDate[d.date] = byDate[d.date] || []).push(d); }
        else if (d.date >= r.prevSince && d.date <= r.prevUntil) prevRows.push(d);
      });
    });
    var rows = r.dates.map(function (d) { return Object.assign({ date: d }, sum(byDate[d] || [])); });
    var current = anyDaily ? sum(rows) : sum(tracked.map(function (t) { return t.stats && t.stats.metrics; }));
    var hasPrev = prevRows.length > 0;
    return { rows: rows, current: derive(current), previous: hasPrev ? derive(sum(prevRows)) : null, anyDaily: anyDaily, days: r.dates.length };
  }
  function delta(cur, prev, key) { if (!prev || !prev[key]) return null; return (cur[key] - prev[key]) / Math.abs(prev[key]); }
  function resultLabel(list) {
    var types = {}; list.forEach(function (t) { var rt = t.stats && t.stats.resultType; if (rt) types[rt] = (types[rt] || 0) + 1; });
    var keys = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; });
    return keys.length === 1 ? keys[0] : keys.length ? 'Results (mixed)' : 'Results';
  }

  // ---- charts (inline SVG, hover crosshair + tooltip) ----
  function chart(rows, lines, opts) {
    opts = opts || {};
    var W = 340, H = opts.height || 210, padL = 40, padR = 8, padT = 10, padB = 24;
    var n = rows.length;
    var max = 0; lines.forEach(function (l) { rows.forEach(function (r) { max = Math.max(max, r[l.key] || 0); }); });
    if (!max) max = 1;
    var nice = Math.pow(10, Math.floor(Math.log10(max))); var top = Math.ceil(max / nice) * nice; if (top / max > 1.6) top = Math.ceil(max / (nice / 2)) * (nice / 2);
    var x = function (i) { return padL + (n > 1 ? (W - padL - padR) * i / (n - 1) : (W - padL - padR) / 2); };
    var y = function (v) { return padT + (H - padT - padB) * (1 - (v || 0) / top); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart', role: 'img', 'aria-label': opts.label || 'chart' });
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = top * t / ticks, yy = y(v);
      svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, 'class': 'chart__grid' }));
      svg.appendChild(s('text', { x: padL - 6, y: yy + 3, 'class': 'chart__tick', 'text-anchor': 'end', text: (opts.money ? symbol() : '') + compact(v) + (opts.pct ? '%' : '') }));
    }
    var labelEvery = Math.max(1, Math.ceil(n / 5));
    rows.forEach(function (r, i) { if (i % labelEvery === 0) svg.appendChild(s('text', { x: x(i), y: H - 8, 'class': 'chart__tick', 'text-anchor': i === 0 ? 'start' : n === 1 ? 'start' : 'middle', text: dateLabel(r.date) })); });
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
      lines.forEach(function (l) { tip.appendChild(h('div', { 'class': 'chart__tiprow' }, [h('span', { 'class': 'chart__swatch', style: 'background:' + l.color }), h('span', { text: l.name }), h('b', { text: l.money ? money(r[l.key] || 0) : opts.pct ? ratio(r[l.key] || 0) + '%' : count(r[l.key] || 0) })])); });
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
  function deltaTag(v, lowerIsBetter) {
    if (v == null) return null;
    var good = lowerIsBetter ? v <= 0 : v >= 0;
    return h('span', { 'class': 'perf__delta ' + (good ? 'is-up' : 'is-down'), title: 'vs the previous period', text: (v >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(v)) });
  }
  // Ten uniform square tiles, five per row: one Meta metric each, with its change vs the previous period and a sparkline.
  function tileSpark(rows, valueOf, color) {
    var W = 120, H = 28, n = rows.length;
    if (n < 2) return null;
    var vals = rows.map(function (d) { var v = valueOf(derive(d)); return v == null || !isFinite(v) ? 0 : v; });
    var max = Math.max.apply(null, vals) || 1;
    var pts = vals.map(function (v, i) { return (W * i / (n - 1)).toFixed(1) + ',' + (H - 2 - (H - 4) * v / max).toFixed(1); });
    return s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'tile__spark', 'aria-hidden': 'true', preserveAspectRatio: 'none' }, [
      s('path', { d: 'M' + pts.join(' L') + ' L' + W + ',' + H + ' L0,' + H + ' Z', fill: color, 'fill-opacity': 0.12 }),
      s('path', { d: 'M' + pts.join(' L'), fill: 'none', stroke: color, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' })
    ]);
  }
  function tile(def, c, p, rows) {
    var d = delta(c, p, def.key);
    return h('div', { 'class': 'card tile' }, [
      h('div', { 'class': 'tile__label', text: def.label }),
      h('div', { 'class': 'tile__value', text: def.fmt(c[def.key]) }),
      deltaTag(d, def.lowerIsBetter) || h('span', { 'class': 'perf__delta tile__delta--none', text: ' ' }),
      rows ? tileSpark(rows, function (d) { return d[def.key]; }, def.color || '#d9d9d9') : null
    ]);
  }
  function summaryCards(sr, r, tracked) {
    var c = sr.current, p = sr.previous, rows = sr.anyDaily ? sr.rows : null;
    var rlabel = resultLabel(tracked);
    var defs = [
      { key: 'spend', label: 'Amount spent', fmt: money, lowerIsBetter: true, color: '#e5534b' },
      { key: 'results', label: rlabel, fmt: count, color: '#3ec27a' },
      { key: 'costPerResult', label: 'Cost per result', fmt: money, lowerIsBetter: true, color: '#e0a52b' },
      { key: 'impressions', label: 'Impressions', fmt: count },
      { key: 'reach', label: 'Reach', fmt: count },
      { key: 'cpm', label: 'CPM', fmt: money, lowerIsBetter: true, color: '#e0a52b' },
      { key: 'cplc', label: 'CPLC', fmt: money, lowerIsBetter: true, color: '#e0a52b' },
      { key: 'ctrAll', label: 'CTR (all)', fmt: pct, color: '#7aa7ff' },
      { key: 'linkCtr', label: 'Link CTR', fmt: pct, color: '#7aa7ff' },
      { key: 'frequency', label: 'Frequency', fmt: ratio, lowerIsBetter: true }
    ];
    return h('div', { 'class': 'tiles' }, defs.map(function (def) { return tile(def, c, p, rows); }));
  }

  // ---- campaign rows ----
  function statusBadge(st) {
    var t = String(st || '').toUpperCase();
    var cls = t === 'ACTIVE' ? 'badge--live' : t === 'PAUSED' || t === 'CAMPAIGN_PAUSED' || t === 'ADSET_PAUSED' ? 'badge--paused' : 'badge--draft';
    return h('span', { 'class': 'badge ' + cls, text: t ? t.replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) : 'Unknown' });
  }
  function rowMetric(value, label, cls) { return h('div', { 'class': 'crow__metric' }, [h('div', { 'class': 'crow__num ' + (cls || ''), text: value }), h('div', { 'class': 'crow__label', text: label })]); }
  function metricCells(m, rlabel, none) {
    var v = function (f) { return none ? '–' : f; };
    return [
      rowMetric(v(money(m.spend || 0, 2)), 'Amount spent'), rowMetric(v(count(m.results)), rlabel), rowMetric(v(money(m.costPerResult)), 'Cost / result'),
      rowMetric(v(count(m.impressions)), 'Impressions'), rowMetric(v(money(m.cpm)), 'CPM'), rowMetric(v(pct(m.ctrAll)), 'CTR (all)'),
      rowMetric(v(pct(m.linkCtr)), 'Link CTR'), rowMetric(v(money(m.cplc)), 'CPLC'), rowMetric(v(ratio(m.frequency)), 'Frequency'), rowMetric(v(count(m.linkClicks)), 'Link clicks')
    ];
  }
  function adRow(ad, r, rlabel) {
    var daily = inRange(ad.daily, r.since, r.until);
    var m = derive(daily.length ? sum(daily) : (ad.daily && ad.daily.length ? {} : ad.metrics || {}));
    var thumb = ad.thumbnailUrl ? h('img', { 'class': 'adrow__thumb', src: ad.thumbnailUrl, alt: '', loading: 'lazy' }) : h('div', { 'class': 'adrow__thumb adrow__thumb--none', text: 'AD' });
    return h('div', { 'class': 'adrow' }, [
      h('div', { 'class': 'adrow__id' }, [thumb, h('div', { 'class': 'adrow__text' }, [ad.previewUrl ? h('a', { 'class': 'adrow__name', href: ad.previewUrl, target: '_blank', rel: 'noopener', text: ad.name }) : h('div', { 'class': 'adrow__name', text: ad.name }), h('div', { 'class': 'crow__meta' }, [statusBadge(ad.status), h('span', { text: ad.adSetName || '' })])])]),
      h('div', { 'class': 'crow__metrics crow__metrics--ad' }, metricCells(m, rlabel, false)),
      h('div', { 'class': 'crow__spark' }, [spark(daily, 'spend', '#e5534b')])
    ]);
  }
  function isOn(id) { try { return localStorage.getItem('adbuilder.campaignOn.' + id) !== '0'; } catch (e) { return true; } }
  function setOn(id, on) { try { localStorage.setItem('adbuilder.campaignOn.' + id, on ? '1' : '0'); } catch (e) {} }
  function campaignRow(t, r) {
    var st = t.stats;
    var daily = inRange(st && st.daily, r.since, r.until);
    var m = st ? derive(daily.length ? sum(daily) : (st.daily && st.daily.length ? {} : st.metrics || {})) : {};
    var none = !st;
    var rlabel = (st && st.resultType) || 'Results';
    var ads = ((st && st.ads) || []).slice().map(function (ad) { return { ad: ad, spend: inRange(ad.daily, r.since, r.until).reduce(function (n, d) { return n + (d.spend || 0); }, 0) }; })
      .sort(function (a, b) { return b.spend - a.spend; }).map(function (x) { return x.ad; });
    var open = false;
    try { open = localStorage.getItem('adbuilder.adsOpen.' + t.id) === '1'; } catch (e) {}
    var adsBox = h('div', { 'class': 'crow__ads', hidden: '' });
    function drawAds() {
      adsBox.innerHTML = '';
      if (!ads.length) adsBox.appendChild(h('p', { 'class': 'muted', text: none ? 'No data yet.' : 'No ad-level rows for this campaign yet. They arrive with the next refresh.' }));
      else {
        adsBox.appendChild(h('div', { 'class': 'adrow adrow--head' }, [h('span', { text: ads.length + ' ad' + (ads.length === 1 ? '' : 's') + ' · ' + r.label + ' · sorted by spend' })]));
        ads.forEach(function (ad) { adsBox.appendChild(adRow(ad, r, rlabel)); });
      }
      adsBox.hidden = !open;
      toggle.textContent = (open ? 'Hide ads' : 'Ads') + (ads.length ? ' (' + ads.length + ')' : '');
      toggle.classList.toggle('is-open', open);
    }
    var toggle = h('button', { 'class': 'crow__toggle', type: 'button', onclick: function () { open = !open; try { localStorage.setItem('adbuilder.adsOpen.' + t.id, open ? '1' : '0'); } catch (e) {} drawAds(); } });
    var onBox = h('input', { type: 'checkbox', checked: isOn(t.id), title: 'Include this campaign in the numbers above' });
    var onSwitch = h('label', { 'class': 'switch' }, [onBox, h('span', { 'class': 'switch__track' }), h('span', { 'class': 'switch__text', text: isOn(t.id) ? 'On' : 'Off' })]);
    onBox.addEventListener('change', function () { setOn(t.id, onBox.checked); render(); });
    var remove = h('button', { 'class': 'crow__remove', title: 'Stop tracking this campaign', type: 'button', onclick: function () {
      request('DELETE', '/api/tracked/' + t.id).then(function (o) { apply(o); }, function (err) { setNotice('error', err.message); });
    } }, ['×']);
    var card = h('div', { 'class': 'card crow' + (isOn(t.id) ? '' : ' is-off') }, [
      h('div', { 'class': 'crow__main' }, [
        onSwitch,
        h('div', { 'class': 'crow__id' }, [
          h('div', { 'class': 'crow__name', text: t.name }),
          h('div', { 'class': 'crow__meta' }, [statusBadge(t.status), h('span', { text: (t.adAccountName || t.adAccountId || '') }), h('span', { 'class': 'crow__cid', text: 'ID ' + t.id })]),
          h('div', { 'class': 'crow__actions' }, [toggle, h('span', { 'class': 'crow__label', text: st ? 'Synced ' + ago(st.syncedAt) : 'No data yet' })])
        ]),
        h('div', { 'class': 'crow__metrics' }, metricCells(m, rlabel, none)),
        h('div', { 'class': 'crow__spark' }, [spark(daily, 'spend', '#e5534b'), h('div', { 'class': 'crow__label', text: 'Spend' })]),
        remove
      ]),
      adsBox
    ]);
    drawAds();
    return card;
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
      panel.appendChild(h('p', { 'class': 'muted', text: 'Which ad accounts do you want to pull campaigns from? ' + (data.source === 'meta' ? 'The campaigns of the ticked accounts are read straight from Meta.' : 'Hermes lists the campaigns of the ticked accounts only. Connect Meta on the Campaigns page for instant pulls.') }));
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
          requestedAt = r.sync.at;
          if (r.sync.direct) { return request('GET', '/api/tracked').then(function (o) { data = o; waiting = false; step = 2; draw(); say('ok', 'Pulled ' + r.sync.count + ' campaign' + (r.sync.count === 1 ? '' : 's') + ' from Meta.'); }); }
          step = 2; draw();
          say('ok', 'Hermes accepted the request and started a run. Campaigns appear below as it sends them (usually within a minute or two); checking every 10 seconds.');
          waitFor(function (o) { return o.catalog.syncedAt && o.catalog.syncedAt > requestedAt; },
            function () { waiting = false; if (step === 2) { draw(); say('ok', 'Campaign list updated ' + when(data.catalog.syncedAt) + '.'); } },
            function () { waiting = false; if (step === 2) { draw(); say('error', 'Hermes has not sent any campaigns after 5 minutes. Check its reply in Slack and the gateway log: it needs the ADBUILDER_API_KEY and a toolset that can call Meta and make HTTP requests.'); } }, 10000, 30);
        }, function (err) { waiting = false; syncAll(); say('error', err.message); });
      } }, ['Pull campaigns']);
      var fetchAccounts = h('button', { 'class': 'btn', type: 'button', onclick: function () {
        fetchAccounts.disabled = true; fetchAccounts.textContent = 'Asking Hermes…';
        request('POST', '/api/tracked/sync', { accounts: [] }).then(function (r) {
          if (r.sync.direct) { return request('GET', '/api/tracked').then(function (o) { data = o; draw(); say('ok', r.sync.count + ' ad account' + (r.sync.count === 1 ? '' : 's') + ' pulled from Meta.'); }); }
          say('ok', 'Hermes accepted the request (HTTP ' + r.sync.status + '). Ad accounts appear here as it sends them; checking every 10 seconds.');
          var before = (data.accounts || []).length;
          waitFor(function (o) { return (o.accounts || []).length > before; },
            function () { if (step === 1) { draw(); say('ok', 'Ad accounts received.'); } },
            function () { fetchAccounts.disabled = false; fetchAccounts.textContent = 'Fetch ad accounts from Hermes'; say('', 'No ad accounts from Hermes yet. Check the Hermes gateway log.'); }, 10000, 30);
        }, function (err) { fetchAccounts.disabled = false; fetchAccounts.textContent = 'Fetch ad accounts from Hermes'; say('error', err.message); });
      } }, [data.source === 'meta' ? 'Fetch ad accounts from Meta' : 'Fetch ad accounts from Hermes']);
      var skip = h('button', { 'class': 'btn', type: 'button', onclick: function () { step = 2; draw(); } }, ['Skip: use campaigns already synced']);
      panel.appendChild(h('div', { 'class': 'picker__foot' }, [h('div', { 'class': 'btn-row' }, [fetchAccounts, skip]), pull]));
      syncAll();
    }

    // What Hermes has and has not done, so a silent wait explains itself.
    function diagnostics() {
      var d = data, lines = [];
      if (d.source === 'meta') { if (d.lastCatalogRequest) lines.push('Last pull from Meta: ' + when(d.lastCatalogRequest.at) + ', ' + d.lastCatalogRequest.count + ' ' + d.lastCatalogRequest.kind + '.'); return h('div', { 'class': 'diag' }, lines.map(function (t) { return h('div', { text: t }); })); }
      var req = d.lastCatalogRequest;
      if (req) lines.push('Last request to Hermes: ' + when(req.at) + ', HTTP ' + req.status + (req.reply && req.reply.status ? ', reply "' + req.reply.status + (req.reply.reason ? ' (' + req.reply.reason + ')' : '') + '"' : '') + (req.reply && req.reply.target ? ', reply goes to ' + req.reply.target : '') + '.');
      if (!d.hermesKeySet) lines.push('No ADBUILDER_API_KEY has been generated, so Hermes cannot send anything back. Generate one in the Hermes card on Ad Builder and give it to Hermes.');
      else if (!d.hermesLastSeenAt) lines.push('Hermes has never called this app with the ADBUILDER_API_KEY. Until it does, nothing can arrive here. Check its reply in Slack: it may be missing the key or a tool to make HTTP requests.');
      else lines.push('Hermes last called this app ' + when(d.hermesLastSeenAt) + '.');
      if (req && req.reply && req.reply.status === 'ignored') lines.push('Hermes ignored the request' + (req.reply.reason === 'event' ? ': the route\'s events list does not include this event. Remove the events line from config.yaml and restart the gateway.' : ' (' + (req.reply.reason || 'no reason') + ').'));
      return h('div', { 'class': 'diag' }, lines.map(function (t) { return h('div', { text: t }); }));
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
        if (!list.children.length) {
          list.appendChild(h('p', { 'class': 'muted', text: waiting ? 'Waiting for Hermes to send the campaign list…' : catalog.length ? 'Nothing matches.' : 'No campaigns synced for these accounts yet. Go back and press "Pull campaigns", or add one by ID below.' }));
          if (waiting || !catalog.length) list.appendChild(diagnostics());
        }
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
  var frameSel = h('select', { 'class': 'table__input frame__select', title: 'Timeframe' }, PRESETS.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
  var sinceIn = h('input', { 'class': 'table__input frame__date', type: 'date' });
  var untilIn = h('input', { 'class': 'table__input frame__date', type: 'date' });
  var customBox = h('div', { 'class': 'frame__custom', hidden: '' }, [sinceIn, h('span', { 'class': 'muted', text: 'to' }), untilIn]);
  function saveFrame() { try { localStorage.setItem('adbuilder.timeframe', JSON.stringify(frame)); } catch (e) {} }
  frameSel.value = frame.preset; sinceIn.value = frame.since || ''; untilIn.value = frame.until || '';
  customBox.hidden = frame.preset !== 'custom';
  frameSel.addEventListener('change', function () { frame.preset = frameSel.value; customBox.hidden = frame.preset !== 'custom'; if (frame.preset === 'custom' && !frame.since) { frame.since = dayKey(6); frame.until = dayKey(0); sinceIn.value = frame.since; untilIn.value = frame.until; } saveFrame(); if (data) render(); });
  [sinceIn, untilIn].forEach(function (inp) { inp.addEventListener('change', function () { frame.since = sinceIn.value; frame.until = untilIn.value; saveFrame(); if (data) render(); }); });
  root.appendChild(h('div', { 'class': 'perf-toolbar' }, [
    h('div', {}, [h('h2', { 'class': 'card__title', text: 'Current campaigns', style: 'margin:0' }), subtitle]),
    h('div', { 'class': 'btn-row perf-toolbar__right' }, [h('div', { 'class': 'frame' }, [frameSel, customBox]), chooseBtn, refreshBtn])
  ]));
  root.appendChild(notice);
  root.appendChild(body);
  // Meta connection: the access token the app pulls campaigns and stats with.
  var metaStatus = h('div', { 'class': 'notice' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Loading…' })]);
  function setMetaStatus(kind, t) { metaStatus.className = 'notice' + (kind ? ' notice--' + kind : ''); metaStatus.lastChild.textContent = t; }
  var tokenIn = h('input', { 'class': 'table__input', type: 'password', autocomplete: 'off', placeholder: 'Meta access token (EAA…)' });
  var tokenSave = h('button', { 'class': 'btn btn--primary', type: 'button' }, ['Save and check']);
  var tokenRemove = h('button', { 'class': 'btn btn--danger', type: 'button', hidden: '' }, ['Remove']);
  function drawMeta(mc) {
    if (!mc) return;
    tokenRemove.hidden = !mc.set || mc.source === 'env';
    tokenIn.disabled = tokenSave.disabled = mc.source === 'env';
    tokenIn.placeholder = mc.set ? 'Saved token ' + mc.masked + ' (paste a new one to replace)' : 'Meta access token (EAA…)';
    setMetaStatus(mc.set ? 'ok' : '', mc.set
      ? 'Connected to Meta' + (mc.user ? ' as ' + mc.user : '') + (mc.accounts != null ? ', ' + mc.accounts + ' ad account' + (mc.accounts === 1 ? '' : 's') : '') + (mc.checkedAt ? ', checked ' + when(mc.checkedAt) : '') + '. Pulls go straight to Meta; Hermes is not used for numbers.'
      : 'Not connected. Paste a Meta access token (ads_read) to pull campaigns and numbers directly. Without it the page asks Hermes instead.');
  }
  tokenSave.addEventListener('click', function () {
    var v = tokenIn.value.trim(); if (!v) { tokenIn.focus(); return; }
    tokenSave.disabled = true; setMetaStatus('', 'Checking the token with Meta…');
    request('PUT', '/api/meta/token', { token: v }).then(function (mc) { tokenIn.value = ''; drawMeta(mc); return load(); }, function (err) { setMetaStatus('error', err.message); }).then(function () { tokenSave.disabled = false; });
  });
  tokenRemove.addEventListener('click', function () {
    if (!confirm('Remove the Meta token? Pulls will go through Hermes again.')) return;
    request('DELETE', '/api/meta/token').then(function (mc) { drawMeta(mc); return load(); }, function (err) { setMetaStatus('error', err.message); });
  });
  root.appendChild(h('div', { 'class': 'card metacard' }, [
    h('h2', { 'class': 'card__title', text: 'Meta connection' }),
    h('p', { 'class': 'muted', text: 'A Meta access token lets this page list your ad accounts and campaigns and pull the numbers itself, on Refresh and at 8:00 and 15:00 Adelaide time. A System User token from Meta Business Settings does not expire; a token from Graph API Explorer lasts about two hours.' }),
    metaStatus,
    h('div', { 'class': 'metacard__row' }, [tokenIn, tokenSave, tokenRemove])
  ]));
  request('GET', '/api/meta/token').then(drawMeta, function () { setMetaStatus('error', 'Could not read the Meta connection.'); });

  function apply(o) { data = o; render(); if (o && o.meta) drawMeta(o.meta); }
  function render() {
    var d = data;
    body.innerHTML = '';
    var cur = d.tracked.filter(function (t) { return t.stats && t.stats.currency; })[0];
    if (cur) currency = cur.stats.currency;
    var next = new Date(d.schedule.nextAt);
    subtitle.textContent = d.tracked.length + ' tracked · ' + (d.source === 'meta' ? 'direct from Meta' : 'via Hermes') + ' · data ' + (d.lastDataAt ? 'from ' + when(d.lastDataAt) : 'not received yet') + ' · next pull ' + next.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short', hour: '2-digit', minute: '2-digit' }) + ' Adelaide' + (d.cronConfigured ? '' : ' (CRON_SECRET not set: scheduled pulls are off)');
    refreshBtn.disabled = !d.tracked.length;
    if (!d.tracked.length) {
      body.appendChild(h('div', { 'class': 'card perf-empty' }, [
        h('h3', { text: 'No campaigns tracked yet' }),
        h('p', { 'class': 'muted', text: 'Press "Choose campaigns", then Refresh. Hermes pulls only the chosen campaigns, at 8:00 and 15:00 Adelaide time and whenever you press Refresh.' }),
        h('p', { 'class': 'muted', text: 'Step 1 picks the ad accounts, step 2 asks Hermes for their campaign list, step 3 ticks what shows here.' })
      ]));
      return;
    }
    var r = rangeOf(frame);
    var on = d.tracked.filter(function (t) { return isOn(t.id); });
    var sr = series(on, r);
    body.appendChild(h('div', { 'class': 'crow-head' }, [h('span', { text: r.label }), h('span', { 'class': 'muted', text: on.length + ' of ' + d.tracked.length + ' campaign' + (d.tracked.length === 1 ? '' : 's') + ' switched on · change vs the previous ' + sr.days + ' day' + (sr.days === 1 ? '' : 's') })]));
    body.appendChild(summaryCards(sr, r, on));
    body.appendChild(h('div', { 'class': 'crow-head' }, [h('span', { text: 'Campaigns' }), h('span', { 'class': 'muted', text: 'Switch a campaign off to leave it out of the numbers above · ' + (d.source === 'meta' ? 'pulled straight from Meta' : d.pending ? 'waiting for Hermes to send new numbers…' : 'numbers as sent by Hermes') })]));
    d.tracked.forEach(function (t) { body.appendChild(campaignRow(t, r)); });
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
    refreshBtn.disabled = true; refreshBtn.textContent = data && data.source === 'meta' ? 'Pulling from Meta…' : 'Asking Hermes…';
    request('POST', '/api/tracked/refresh').then(function (r) {
      if (r.refresh.direct) {
        var errs = r.refresh.errors || [];
        setNotice(errs.length ? 'error' : 'ok', 'Pulled ' + r.refresh.stored + ' of ' + r.refresh.campaigns + ' campaign' + (r.refresh.campaigns === 1 ? '' : 's') + ' from Meta.' + (errs.length ? ' Failed: ' + errs.map(function (e) { return e.name + ' (' + e.error + ')'; }).join('; ') : ''));
        return load();
      }
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
