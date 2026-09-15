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
  var KEYS = ['spend', 'impressions', 'reach', 'clicksAll', 'linkClicks', 'uniqueClicks', 'uniqueLinkClicks', 'outboundClicks', 'landingPageViews', 'results', 'revenue', 'purchases', 'leads', 'newLeads', 'calls',
    'postEngagement', 'pageEngagement', 'reactions', 'comments', 'shares', 'saves', 'pageLikes', 'videoPlays', 'videoViews3s', 'thruplays', 'videoP25', 'videoP50', 'videoP75', 'videoP100', 'messaging', 'socialSpend', 'bookings'];
  // Every metric the tiles and cards can show. "conv.x" keys are the standard website/app events each row carries.
  var CATALOG = [
    { g: 'Spend & delivery', key: 'spend', label: 'Amount spent', fmt: money, low: true, color: '#e5534b' },
    { g: 'Spend & delivery', key: 'impressions', label: 'Impressions', fmt: count },
    { g: 'Spend & delivery', key: 'reach', label: 'Reach', fmt: count },
    { g: 'Spend & delivery', key: 'frequency', label: 'Frequency', fmt: ratio, low: true },
    { g: 'Spend & delivery', key: 'cpm', label: 'CPM', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Spend & delivery', key: 'cpp', label: 'Cost per 1,000 reached', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Spend & delivery', key: 'socialSpend', label: 'Social spend', fmt: money, low: true },
    { g: 'Results', key: 'results', label: 'Results', fmt: count, color: '#3ec27a', dyn: true },
    { g: 'Results', key: 'costPerResult', label: 'Cost per result', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Results', key: 'resultRate', label: 'Result rate', fmt: pct },
    { g: 'Clicks', key: 'clicksAll', label: 'Clicks (all)', fmt: count },
    { g: 'Clicks', key: 'linkClicks', label: 'Link clicks', fmt: count },
    { g: 'Clicks', key: 'uniqueClicks', label: 'Unique clicks (all)', fmt: count },
    { g: 'Clicks', key: 'uniqueLinkClicks', label: 'Unique link clicks', fmt: count },
    { g: 'Clicks', key: 'outboundClicks', label: 'Outbound clicks', fmt: count },
    { g: 'Clicks', key: 'landingPageViews', label: 'Landing page views', fmt: count },
    { g: 'Clicks', key: 'ctrAll', label: 'CTR (all)', fmt: pct, color: '#7aa7ff' },
    { g: 'Clicks', key: 'linkCtr', label: 'Link CTR', fmt: pct, color: '#7aa7ff' },
    { g: 'Clicks', key: 'uniqueLinkCtr', label: 'Unique link CTR', fmt: pct, color: '#7aa7ff' },
    { g: 'Clicks', key: 'outboundCtr', label: 'Outbound CTR', fmt: pct, color: '#7aa7ff' },
    { g: 'Clicks', key: 'cpc', label: 'CPC (all)', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Clicks', key: 'cplc', label: 'CPLC', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Clicks', key: 'costPerOutbound', label: 'Cost per outbound click', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Clicks', key: 'costPerLpv', label: 'Cost per landing page view', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Conversions', key: 'leads', label: 'Leads', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'cpl', label: 'Cost per lead', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Conversions', key: 'conv.schedule', label: 'Website schedules', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'costPerSchedule', label: 'Cost per schedule', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Conversions', key: 'purchases', label: 'Purchases', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'costPerSale', label: 'Cost per purchase', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Conversions', key: 'revenue', label: 'Purchase value', fmt: money, color: '#3ec27a' },
    { g: 'Conversions', key: 'roas', label: 'Purchase ROAS', fmt: ratio, color: '#3ec27a' },
    { g: 'Conversions', key: 'conv.contact', label: 'Contacts', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'conv.complete_registration', label: 'Registrations', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'conv.submit_application', label: 'Applications', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'conv.add_to_cart', label: 'Adds to cart', fmt: count },
    { g: 'Conversions', key: 'conv.initiate_checkout', label: 'Checkouts initiated', fmt: count },
    { g: 'Conversions', key: 'conv.view_content', label: 'Content views', fmt: count },
    { g: 'Conversions', key: 'conv.subscribe', label: 'Subscriptions', fmt: count },
    { g: 'Conversions', key: 'conv.start_trial', label: 'Trials started', fmt: count },
    { g: 'Conversions', key: 'messaging', label: 'Conversations started', fmt: count, color: '#3ec27a' },
    { g: 'Conversions', key: 'costPerMessaging', label: 'Cost per conversation', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Conversions', key: 'calls', label: 'Calls', fmt: count },
    { g: 'Engagement', key: 'postEngagement', label: 'Post engagement', fmt: count },
    { g: 'Engagement', key: 'costPerEngagement', label: 'Cost per post engagement', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Engagement', key: 'pageEngagement', label: 'Page engagement', fmt: count },
    { g: 'Engagement', key: 'reactions', label: 'Post reactions', fmt: count },
    { g: 'Engagement', key: 'comments', label: 'Post comments', fmt: count },
    { g: 'Engagement', key: 'shares', label: 'Post shares', fmt: count },
    { g: 'Engagement', key: 'saves', label: 'Post saves', fmt: count },
    { g: 'Engagement', key: 'pageLikes', label: 'Page likes', fmt: count },
    { g: 'Video', key: 'videoPlays', label: 'Video plays', fmt: count },
    { g: 'Video', key: 'videoViews3s', label: '3-second video plays', fmt: count },
    { g: 'Video', key: 'thruplays', label: 'ThruPlays', fmt: count },
    { g: 'Video', key: 'costPerThruplay', label: 'Cost per ThruPlay', fmt: money, low: true, color: '#e0a52b' },
    { g: 'Video', key: 'thruplayRate', label: 'ThruPlay rate', fmt: pct },
    { g: 'Video', key: 'videoP25', label: 'Video plays at 25%', fmt: count },
    { g: 'Video', key: 'videoP50', label: 'Video plays at 50%', fmt: count },
    { g: 'Video', key: 'videoP75', label: 'Video plays at 75%', fmt: count },
    { g: 'Video', key: 'videoP100', label: 'Video plays at 100%', fmt: count }
  ];
  var BY_KEY = {}; CATALOG.forEach(function (c) { BY_KEY[c.key] = c; });
  var MAX_METRICS = 15;
  function derive(m) {
    m = m || {};
    var out = Object.assign({}, m);
    var link = m.linkClicks != null ? m.linkClicks : null;
    var all = m.clicksAll != null ? m.clicksAll : null;
    var per = function (n) { return n ? (m.spend || 0) / n : null; };
    out.cpm = m.impressions ? (m.spend || 0) / m.impressions * 1000 : null;
    out.cpp = m.reach ? (m.spend || 0) / m.reach * 1000 : null;
    out.cpc = per(all);
    out.cplc = per(link);
    out.costPerOutbound = per(m.outboundClicks);
    out.costPerLpv = per(m.landingPageViews);
    out.ctrAll = all != null && m.impressions ? all / m.impressions : null;
    out.linkCtr = link != null && m.impressions ? link / m.impressions : null;
    out.uniqueLinkCtr = m.uniqueLinkClicks != null && m.impressions ? m.uniqueLinkClicks / m.impressions : null;
    out.outboundCtr = m.outboundClicks != null && m.impressions ? m.outboundClicks / m.impressions : null;
    out.frequency = m.reach ? (m.impressions || 0) / m.reach : null;
    out.costPerResult = per(m.results);
    out.resultRate = m.impressions && m.results != null ? m.results / m.impressions : null;
    out.profit = m.revenue != null ? m.revenue - (m.spend || 0) : null;
    out.roas = div(m.revenue, m.spend);
    out.cpl = per(m.leads);
    out.costPerSale = per(m.purchases);
    out.costPerSchedule = per(m['conv.schedule']);
    out.costPerMessaging = per(m.messaging);
    out.costPerEngagement = per(m.postEngagement);
    out.costPerThruplay = per(m.thruplays);
    out.thruplayRate = m.impressions && m.thruplays != null ? m.thruplays / m.impressions : null;
    out.costPerBooking = per(m.bookings);
    return out;
  }
  function sum(list) {
    var out = {};
    list.forEach(function (m) {
      if (!m) return;
      KEYS.forEach(function (k) { if (m[k] != null) out[k] = (out[k] || 0) + m[k]; });
      if (m.conv) Object.keys(m.conv).forEach(function (k) { out['conv.' + k] = (out['conv.' + k] || 0) + m.conv[k]; });
      Object.keys(m).forEach(function (k) { if (k.indexOf('conv.') === 0) out[k] = (out[k] || 0) + m[k]; });
    });
    return out;
  }
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
  // Bookings logged by hand (Ad Accounts tab) for the clients whose campaigns are switched on: { byDate, label }.
  function bookingsFor(tracked) {
    var onAccts = {}; tracked.forEach(function (t) { onAccts[accountKey(t)] = true; });
    var byDate = {}, labels = {}, any = false;
    ((data && data.bookings) || []).forEach(function (b) {
      if (!b.metaAccountId || !onAccts[b.metaAccountId] || !b.entries.length) return;
      any = true; labels[b.label || 'Bookings'] = true;
      b.entries.forEach(function (e) { byDate[e.date] = (byDate[e.date] || 0) + (e.count || 0); });
    });
    var names = Object.keys(labels);
    return { any: any, byDate: byDate, label: names.length === 1 ? names[0] : 'Bookings' };
  }
  function series(tracked, r) {
    var byDate = {}, anyDaily = false, prevRows = [];
    tracked.forEach(function (t) {
      var rows0 = withResults(t.stats && t.stats.daily, t.resultOverride);
      if (!countable(t)) rows0 = rows0.map(function (d) { return Object.assign({}, d, { results: 0 }); });
      rows0.forEach(function (d) {
        anyDaily = true;
        if (d.date >= r.since && d.date <= r.until) { (byDate[d.date] = byDate[d.date] || []).push(d); }
        else if (d.date >= r.prevSince && d.date <= r.prevUntil) prevRows.push(d);
      });
    });
    var bk = bookingsFor(tracked);
    var rows = r.dates.map(function (d) { var row = Object.assign({ date: d }, sum(byDate[d] || [])); if (bk.any) row.bookings = bk.byDate[d] || 0; return row; });
    var current = anyDaily ? sum(rows) : sum(tracked.map(function (t) { return t.stats && t.stats.metrics; }));
    var hasPrev = prevRows.length > 0;
    var previous = hasPrev ? sum(prevRows) : null;
    if (bk.any) {
      var inRangeTotal = function (since, until) { var n = 0; Object.keys(bk.byDate).forEach(function (d) { if (d >= since && d <= until) n += bk.byDate[d]; }); return n; };
      current.bookings = inRangeTotal(r.since, r.until);
      if (previous) previous.bookings = inRangeTotal(r.prevSince, r.prevUntil);
    }
    return { rows: rows, current: derive(current), previous: previous ? derive(previous) : null, anyDaily: anyDaily, days: r.dates.length, bookings: bk };
  }
  function delta(cur, prev, key) { if (!prev || !prev[key]) return null; return (cur[key] - prev[key]) / Math.abs(prev[key]); }
  // What the change arrows compare against, in words: "last week", "the day before", "the previous 30 days".
  function compareLabel(r) {
    var n = r.dates.length;
    if (frame.preset === 'today') return 'yesterday';
    if (frame.preset === 'yesterday') return 'the day before';
    if (frame.preset === 'month' || frame.preset === 'lastmonth') return 'the month before';
    if (n === 7) return 'last week';
    if (n === 14) return 'the previous 2 weeks';
    if (n === 30) return 'the previous 30 days';
    return 'the previous ' + n + ' day' + (n === 1 ? '' : 's');
  }
  function changeText(v, r) { return (v >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(v)) + ' ' + (v >= 0 ? 'more' : 'less') + ' than ' + compareLabel(r); }
  var LABELS = { lead: 'Leads', schedule: 'Website schedules', purchase: 'Purchases', contact: 'Contacts', complete_registration: 'Registrations', submit_application: 'Applications', start_trial: 'Trials', subscribe: 'Subscriptions', add_to_cart: 'Adds to cart', initiate_checkout: 'Checkouts', add_payment_info: 'Payment info', search: 'Searches', view_content: 'Content views', find_location: 'Location finds', customize_product: 'Customisations', donate: 'Donations', link_click: 'Link clicks', landing_page_view: 'Landing page views', messaging: 'Conversations', thruplay: 'ThruPlays', app_install: 'App installs', post_engagement: 'Engagements', reach: 'Reach', impressions: 'Impressions' };
  function labelFor(key, extra) { return (extra && extra[key]) || LABELS[key] || (key ? key.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : 'Results'); }
  // The result key a campaign uses: its manual override, else what its ad sets optimise for.
  function resultKeyOf(t) { return t.resultOverride || (t.stats && t.stats.resultKey) || ''; }
  function allConvLabels() { var out = {}; ((data && data.tracked) || []).forEach(function (t) { Object.assign(out, (t.stats && t.stats.convLabels) || {}); }); return out; }
  function campaignResultLabel(t) { var k = resultKeyOf(t); return k ? labelFor(k, allConvLabels()) : (t.stats && t.stats.resultType) || 'Results'; }
  // Old pulls have no per-day conversion breakdown; a result-type change then needs a fresh pull.
  function hasConv(t) { return ((t.stats && t.stats.daily) || []).some(function (d) { return d.conv; }); }
  // Daily rows with "results" recomputed for the chosen key (from the conversions each row carries).
  function withResults(rows, key) {
    if (!key) return rows || [];
    return (rows || []).map(function (d) {
      var v = key === 'reach' ? d.reach : key === 'impressions' ? d.impressions : (d.conv && d.conv[key]) || 0;
      return Object.assign({}, d, { results: v || 0 });
    });
  }
  function countable(t) { var k = resultKeyOf(t); return k !== 'reach' && k !== 'impressions'; }
  function resultLabel(list) {
    var types = {}; list.filter(countable).forEach(function (t) { var rt = campaignResultLabel(t); if (rt) types[rt] = (types[rt] || 0) + 1; });
    var keys = Object.keys(types).sort(function (a, b) { return types[b] - types[a]; });
    return keys.length === 0 ? 'Results' : keys.length <= 3 ? keys.join(' + ') : 'Results (mixed)';
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
  var currentRange = null;
  function deltaTag(v, lowerIsBetter) {
    if (v == null) return null;
    var good = lowerIsBetter ? v <= 0 : v >= 0;
    return h('span', { 'class': 'perf__delta ' + (good ? 'is-up' : 'is-down'), title: 'Compared with ' + (currentRange ? compareLabel(currentRange) : 'the previous period'), text: currentRange ? changeText(v, currentRange) : (v >= 0 ? '▲ ' : '▼ ') + pct(Math.abs(v)) });
  }
  // Ten uniform square tiles, five per row: one Meta metric each, with its change vs the previous period and a sparkline.
  // Straight line of best fit (least squares) through the daily values, so the direction over the period is
  // clear even when the days are spiky. Days with no value are left out of the fit.
  function trendOf(vals) {
    var pts = []; vals.forEach(function (v, i) { if (v != null && isFinite(v)) pts.push([i, v]); });
    var n = pts.length; if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
    var den = n * sxx - sx * sx; if (!den) return null;
    var slope = (n * sxy - sx * sy) / den, intercept = (sy - slope * sx) / n;
    return { slope: slope, intercept: intercept, first: pts[0][0], last: pts[n - 1][0] };
  }
  function tileSpark(rows, valueOf, color) {
    var W = 120, H = 28, n = rows.length;
    if (n < 2) return null;
    var raw = rows.map(function (d) { var v = valueOf(derive(d)); return v == null || !isFinite(v) ? null : v; });
    var vals = raw.map(function (v) { return v == null ? 0 : v; });
    var max = Math.max.apply(null, vals) || 1;
    var y = function (v) { return (H - 2 - (H - 4) * Math.max(0, Math.min(max, v)) / max).toFixed(1); };
    var x = function (i) { return (W * i / (n - 1)).toFixed(1); };
    var pts = vals.map(function (v, i) { return x(i) + ',' + y(v); });
    var t = trendOf(raw);
    var kids = [
      s('path', { d: 'M' + pts.join(' L') + ' L' + W + ',' + H + ' L0,' + H + ' Z', fill: color, 'fill-opacity': 0.12 }),
      s('path', { d: 'M' + pts.join(' L'), fill: 'none', stroke: color, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' })
    ];
    if (t) kids.push(s('line', { x1: x(t.first), y1: y(t.intercept + t.slope * t.first), x2: x(t.last), y2: y(t.intercept + t.slope * t.last), 'class': 'tile__trend', stroke: color === '#d9d9d9' ? '#2ee6a6' : '#ffffff', 'stroke-opacity': 0.75, 'stroke-width': 1, 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' }));
    return s('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'tile__spark', 'aria-hidden': 'true', preserveAspectRatio: 'none' }, kids);
  }
  function tile(def, c, p, rows) {
    var d = delta(c, p, def.key);
    var valueEl = h('div', { 'class': 'tile__value', text: def.fmt(c[def.key]) });
    var labelEl = h('div', { 'class': 'tile__label', text: def.label });
    var deltaEl = deltaTag(d, def.lowerIsBetter) || h('span', { 'class': 'perf__delta tile__delta--none', text: ' ' });
    var marker = h('div', { 'class': 'tile__marker', hidden: '' });
    var el = h('div', { 'class': 'card tile' + (def.logged ? ' tile--logged' : ''), title: def.logged ? 'Logged by hand in the Ad Accounts tab for the switched-on clients; cost uses the spend of the switched-on campaigns.' : '' }, [labelEl, valueEl, deltaEl, rows ? tileSpark(rows, function (d) { return d[def.key]; }, def.color || '#d9d9d9') : null, marker]);
    if (rows && rows.length) {
      // Move or drag across the tile to read that day's value; leave to return to the period total.
      var n = rows.length;
      function at(evt) {
        var box = el.getBoundingClientRect();
        var x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - box.left;
        var i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(x / box.width * (n - 1))));
        var row = rows[i], v = derive(row)[def.key];
        valueEl.textContent = def.fmt(v);
        labelEl.textContent = def.label + ' · ' + dateLabel(row.date);
        deltaEl.textContent = 'that day · release to return';
        marker.hidden = false; marker.style.left = (n === 1 ? 50 : i / (n - 1) * 100) + '%';
        el.classList.add('is-scrub');
      }
      function reset() {
        valueEl.textContent = def.fmt(c[def.key]); labelEl.textContent = def.label;
        var fresh = deltaTag(d, def.lowerIsBetter); deltaEl.textContent = fresh ? fresh.textContent : ' ';
        marker.hidden = true; el.classList.remove('is-scrub');
      }
      el.addEventListener('mousemove', at); el.addEventListener('mouseleave', reset);
      el.addEventListener('touchstart', at, { passive: true }); el.addEventListener('touchmove', at, { passive: true }); el.addEventListener('touchend', reset);
    }
    return el;
  }
  var GREYS = ['#4a4f4d', '#6a706d', '#8a918d', '#a9b0ac', '#c4cac6', '#3a3e3c', '#5a5f5c'];
  function hero(sr, r, tracked) {
    var c = sr.current, p = sr.previous;
    var rlabel = resultLabel(tracked);
    var per = tracked.map(function (t) {
      var daily = inRange(withResults(t.stats && t.stats.daily, t.resultOverride), r.since, r.until);
      var m = derive(sum(daily));
      return { t: t, spend: m.spend || 0, results: countable(t) ? m.results || 0 : 0, cpr: countable(t) ? m.costPerResult : null, label: campaignResultLabel(t) };
    }).sort(function (a, b) { return b.spend - a.spend; });
    var total = per.reduce(function (n, x) { return n + x.spend; }, 0);
    var best = per.filter(function (x) { return x.cpr != null; }).sort(function (a, b) { return a.cpr - b.cpr; })[0];
    var segs = per.map(function (x, i) { return h('div', { 'class': 'split__seg' + (best && x.t.id === best.t.id ? ' is-best' : ''), style: 'flex:' + Math.max(x.spend, total * 0.02 || 1) + ';background:' + (best && x.t.id === best.t.id ? '' : GREYS[i % GREYS.length]), title: x.t.name + ' · ' + money(x.spend) }); });
    var legend = per.map(function (x, i) {
      var isBest = best && x.t.id === best.t.id;
      return h('div', { 'class': 'split__row' + (isBest ? ' is-best' : '') }, [h('span', { 'class': 'split__dot', style: isBest ? '' : 'background:' + GREYS[i % GREYS.length] }), h('span', { 'class': 'split__name', text: x.t.name }), h('span', { 'class': 'split__val', text: money(x.spend, 0) + (x.results ? ' · ' + count(x.results) + ' ' + x.label.toLowerCase() + ' · ' + money(x.cpr) + ' each' : '') })]);
    });
    return h('div', { 'class': 'hero' }, [
      h('div', { 'class': 'hero__nums' }, [
        h('div', { 'class': 'hero__num' }, [h('div', { 'class': 'mono', text: 'Amount spent' }), h('div', { 'class': 'hero__big', text: money(c.spend || 0, 0) }), h('div', { 'class': 'hero__sub', text: 'across ' + tracked.length + ' campaign' + (tracked.length === 1 ? '' : 's') + (p && delta(c, p, 'spend') != null ? ' · ' + changeText(delta(c, p, 'spend'), r) : '') })]),
        h('div', { 'class': 'hero__but mono', text: 'for' }),
        h('div', { 'class': 'hero__num' }, [h('div', { 'class': 'mono', text: rlabel }), h('div', { 'class': 'hero__big is-green', text: count(c.results) }), h('div', { 'class': 'hero__sub', text: 'cost per result ' + money(c.costPerResult) + (p && delta(c, p, 'results') != null ? ' · ' + changeText(delta(c, p, 'results'), r) : '') })])
      ]),
      h('div', { 'class': 'split' }, segs),
      h('div', { 'class': 'split__legend' }, legend.concat(best ? [h('div', { 'class': 'split__row is-best split__row--note' }, [h('span', { 'class': 'split__dot' }), h('span', { 'class': 'split__name', text: 'Best cost per result' }), h('span', { 'class': 'split__val', text: best.t.name + ' · ' + money(best.cpr) })])] : []))
    ]);
  }
  // The chosen metrics as tile/cell definitions (the Results label follows the campaigns' result type).
  function chosenDefs(rlabel) {
    var keys = (data && data.dashboard && data.dashboard.metrics) || [];
    return keys.map(function (k) { return BY_KEY[k]; }).filter(Boolean).map(function (c) { return { key: c.key, label: c.dyn ? rlabel : c.label, fmt: c.fmt, lowerIsBetter: !!c.low, color: c.color }; });
  }
  function summaryCards(sr, r, tracked) {
    var c = sr.current, p = sr.previous, rows = sr.anyDaily ? sr.rows : null;
    var defs = chosenDefs(resultLabel(tracked));
    if (sr.bookings && sr.bookings.any) {
      var bl = sr.bookings.label, unit = bl.replace(/s$/i, '').toLowerCase();
      defs = [
        { key: 'bookings', label: bl + ' (logged)', fmt: count, lowerIsBetter: false, color: '#2ee6a6', logged: true },
        { key: 'costPerBooking', label: 'Cost per ' + unit, fmt: money, lowerIsBetter: true, color: '#e0a52b', logged: true }
      ].concat(defs);
    }
    var grid = h('div', { 'class': 'tiles' }, defs.map(function (def) { return tile(def, c, p, rows); }));
    grid.appendChild(h('button', { 'class': 'tile tile--add', type: 'button', title: 'Choose which metrics to show', onclick: openMetrics }, [h('span', { 'class': 'tile__plus', text: '+' }), h('span', { 'class': 'tile__label', text: defs.filter(function (d) { return !d.logged; }).length + ' / ' + MAX_METRICS + ' metrics' })]));
    return grid;
  }

  // ---- best creatives: every ad of the switched-on campaigns, ranked for the timeframe, five per page ----
  var creativePage = 0, PAGE = 5;
  function rankedCreatives(tracked, r) {
    var out = [];
    tracked.forEach(function (t) {
      var key = t.resultOverride, rlabel = campaignResultLabel(t);
      ((t.stats && t.stats.ads) || []).forEach(function (ad) {
        var daily = inRange(withResults(ad.daily, key), r.since, r.until);
        if (!daily.length) return;
        var m = derive(sum(daily));
        if (!m.spend) return;
        out.push({ ad: ad, campaign: t, m: m, rlabel: rlabel, countable: countable(t) });
      });
    });
    // Best first: lowest cost per result among ads with results, then most results, then most spend.
    out.sort(function (a, b) {
      var ac = a.countable && a.m.costPerResult != null, bc = b.countable && b.m.costPerResult != null;
      if (ac && bc) return a.m.costPerResult - b.m.costPerResult || b.m.results - a.m.results;
      if (ac !== bc) return ac ? -1 : 1;
      return (b.m.results || 0) - (a.m.results || 0) || (b.m.spend || 0) - (a.m.spend || 0);
    });
    return out;
  }
  function shortUrl(u) { try { var x = new URL(u); return (x.host.replace(/^www\./, '') + (x.pathname === '/' ? '' : x.pathname)).slice(0, 48); } catch (e) { return String(u).slice(0, 48); } }
  function linkLine(ad, cls) {
    if (!ad.linkUrl) return h('div', { 'class': cls + ' is-none', text: 'No destination link' });
    return h('a', { 'class': cls, href: ad.linkUrl, target: '_blank', rel: 'noopener', title: ad.linkUrl, text: '↗ ' + shortUrl(ad.linkUrl) });
  }
  // Download button(s) for an ad's creative: the video when it has one, and the full-size image. Served through
  // the app (/api/ads/:id/download) because Meta's CDN blocks direct downloads from the browser.
  function downloadLinks(ad, cls) {
    var out = [];
    var mk = function (kind, label) { return h('a', { 'class': 'dl ' + (cls || ''), href: '/api/ads/' + encodeURIComponent(ad.id) + '/download?kind=' + kind, download: '', title: 'Download the ' + kind + ' file' }, [h('span', { 'class': 'dl__icon', text: '\u2913' }), h('span', { text: label })]); };
    if (ad.videoId) out.push(mk('video', 'Video'));
    if (ad.imageUrl) out.push(mk('image', ad.videoId ? 'Poster' : 'Image'));
    return out;
  }
  function creativeCard(item, rank) {
    var ad = item.ad, m = item.m;
    var src = ad.imageUrl || ad.thumbnailUrl;
    var img = src ? h('img', { 'class': 'bc__img', src: src, alt: '', loading: 'lazy', decoding: 'async' }) : h('div', { 'class': 'bc__img bc__img--none', text: 'No preview' });
    var frame = ad.previewUrl ? h('a', { 'class': 'bc__frame', href: ad.previewUrl, target: '_blank', rel: 'noopener', title: 'Open in Meta' }, [img]) : h('div', { 'class': 'bc__frame' }, [img]);
    var stat = function (v, label, cls) { return h('div', { 'class': 'bc__stat' }, [h('span', { 'class': 'bc__label', text: label }), h('span', { 'class': 'bc__num ' + (cls || ''), text: v })]); };
    return h('div', { 'class': 'card bc' + (rank === 1 ? ' is-top' : '') }, [
      h('div', { 'class': 'bc__rank mono', text: pad(rank) }),
      frame,
      h('div', { 'class': 'bc__name', title: ad.name, text: ad.name }),
      h('div', { 'class': 'bc__meta', text: item.campaign.name + (ad.adSetName ? ' · ' + ad.adSetName : '') }),
      linkLine(ad, 'bc__link'),
      h('div', { 'class': 'bc__tools' }, downloadLinks(ad).concat(ad.previewUrl ? [h('a', { 'class': 'dl dl--ghost', href: ad.previewUrl, target: '_blank', rel: 'noopener' }, ['Open in Meta'])] : [])),
      h('div', { 'class': 'bc__stats' }, [
        stat(money(m.spend), 'Amount spent'),
        stat(money(m.cpm), 'CPM'),
        stat(count(m.results), item.rlabel),
        stat(money(m.cplc), 'CPLC'),
        stat(pct(m.ctrAll), 'CTR (all)'),
        stat(money(m.costPerResult), 'Cost per result', m.costPerResult != null ? 'is-pos' : '')
      ])
    ]);
  }
  function bestCreatives(tracked, r) {
    var items = rankedCreatives(tracked, r);
    var pages = Math.max(1, Math.ceil(items.length / PAGE));
    if (creativePage >= pages) creativePage = pages - 1;
    if (creativePage < 0) creativePage = 0;
    var wrap = h('div', { 'class': 'bestc' });
    var grid = h('div', { 'class': 'bestc-grid' });
    var counter = h('span', { 'class': 'mono' });
    var prev = h('button', { 'class': 'btn bc-nav', type: 'button', title: 'Previous 5' }, ['‹']);
    var next = h('button', { 'class': 'btn bc-nav', type: 'button', title: 'Next 5' }, ['›']);
    function draw() {
      grid.innerHTML = '';
      var start = creativePage * PAGE;
      items.slice(start, start + PAGE).forEach(function (it, i) { grid.appendChild(creativeCard(it, start + i + 1)); });
      if (!items.length) grid.appendChild(h('p', { 'class': 'muted', text: 'No ad-level rows in this timeframe yet. Press Refresh to pull them.' }));
      counter.textContent = items.length ? (start + 1) + '–' + Math.min(start + PAGE, items.length) + ' of ' + items.length : '0';
      prev.disabled = creativePage === 0; next.disabled = creativePage >= pages - 1;
    }
    prev.addEventListener('click', function () { creativePage--; draw(); });
    next.addEventListener('click', function () { creativePage++; draw(); });
    wrap.appendChild(h('div', { 'class': 'crow-head' }, [h('span', { text: 'Best creatives' }), h('span', { 'class': 'bc-head__right' }, [h('span', { 'class': 'muted', text: r.label + ' · ranked by cost per result · ' }), counter, prev, next])]));
    wrap.appendChild(grid);
    draw();
    return wrap;
  }

  // ---- campaign rows ----
  function statusBadge(st) {
    var t = String(st || '').toUpperCase();
    var cls = t === 'ACTIVE' ? 'badge--live' : t === 'PAUSED' || t === 'CAMPAIGN_PAUSED' || t === 'ADSET_PAUSED' ? 'badge--paused' : 'badge--draft';
    return h('span', { 'class': 'badge ' + cls, text: t ? t.replace(/_/g, ' ').toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) : 'Unknown' });
  }
  function rowMetric(value, label, cls) { return h('div', { 'class': 'crow__metric' }, [h('div', { 'class': 'crow__num ' + (cls || ''), text: value }), h('div', { 'class': 'crow__label', text: label })]); }
  function metricCells(m, rlabel, none) {
    return chosenDefs(rlabel).map(function (def) { return rowMetric(none ? '–' : def.fmt(m[def.key]), def.label); });
  }
  function adRow(ad, r, rlabel, key) {
    var daily = inRange(withResults(ad.daily, key), r.since, r.until);
    var m = derive(daily.length ? sum(daily) : (ad.daily && ad.daily.length ? {} : ad.metrics || {}));
    var thumb = ad.thumbnailUrl ? h('img', { 'class': 'adrow__thumb', src: ad.thumbnailUrl, alt: '', loading: 'lazy' }) : h('div', { 'class': 'adrow__thumb adrow__thumb--none', text: 'AD' });
    return h('div', { 'class': 'adrow' }, [
      h('div', { 'class': 'adrow__id' }, [thumb, h('div', { 'class': 'adrow__text' }, [ad.previewUrl ? h('a', { 'class': 'adrow__name', href: ad.previewUrl, target: '_blank', rel: 'noopener', text: ad.name }) : h('div', { 'class': 'adrow__name', text: ad.name }), h('div', { 'class': 'crow__meta' }, [statusBadge(ad.status), h('span', { text: ad.adSetName || '' })]), linkLine(ad, 'adrow__link'), h('div', { 'class': 'adrow__tools' }, downloadLinks(ad, 'dl--sm'))])]),
      h('div', { 'class': 'crow__metrics crow__metrics--ad' }, metricCells(m, rlabel, false)),
      h('div', { 'class': 'crow__spark' }, [spark(daily, 'spend', '#e5534b')])
    ]);
  }
  // What Meta reported for this campaign: optimisation per ad set and every action type seen in the stored days.
  function metaSays(t) {
    var st = t.stats, acts = {};
    (st.daily || []).forEach(function (d) { Object.keys(d.actions || {}).forEach(function (k) { acts[k] = (acts[k] || 0) + d.actions[k]; }); });
    var keys = Object.keys(acts).sort(function (a, b) { return acts[b] - acts[a]; });
    var opt = (st.optimisation || []).map(function (o) { return (o.name || o.id) + ': ' + (o.goal || '?').toLowerCase().replace(/_/g, ' ') + (o.event ? ' · ' + o.event.toLowerCase().replace(/_/g, ' ') : '') + (o.customConversionId ? ' · custom conversion ' + o.customConversionId : ''); });
    var det = h('details', { 'class': 'metasays' }, [
      h('summary', { 'class': 'crow__label', text: 'Meta says: result = ' + (st.resultKey || '?') + (opt.length ? ' · ' + opt.length + ' ad set' + (opt.length === 1 ? '' : 's') : '') + ' · ' + keys.length + ' action types seen' }),
      h('div', { 'class': 'metasays__body' }, [
        h('div', { 'class': 'mono', text: 'Optimisation' }),
        h('div', { text: opt.length ? opt.join('  |  ') : 'No ad set data yet (refresh).' }),
        h('div', { 'class': 'mono', style: 'margin-top:6px', text: 'Action types in stored days' }),
        h('div', { text: keys.length ? keys.map(function (k) { return k + ' ' + count(acts[k]); }).join('  ·  ') : 'None recorded.' })
      ])
    ]);
    return det;
  }
  function flag(key) { try { return localStorage.getItem(key) !== '0'; } catch (e) { return true; } }
  function setFlag(key, on) { try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {} }
  function accountKey(t) { return t.adAccountId || 'none'; }
  function accountOn(t) { return flag('adbuilder.accountOn.' + accountKey(t)); }
  function campaignOn(id) { return flag('adbuilder.campaignOn.' + id); }
  function isOn(id) { var t = ((data && data.tracked) || []).filter(function (x) { return x.id === id; })[0]; return t ? accountOn(t) && campaignOn(id) : campaignOn(id); }
  function setOn(id, on) { setFlag('adbuilder.campaignOn.' + id, on); }
  // Two rows of pills: one per client (ad account), then one per campaign of the clients that are on.
  // ---- bookings log, per client, on this tab: dates and counts tied to the client's Meta ad account ----
  function bookingDocFor(acctKey) {
    return ((data && data.bookings) || []).filter(function (b) { return b.metaAccountId === acctKey; }).sort(function (a, b) { return (b.entries.length - a.entries.length); })[0] || null;
  }
  function openBookings(acct) {
    var existing = bookingDocFor(acct.key);
    var docId = existing ? existing.accountId : acct.key;
    var entries = ((existing && existing.entries) || []).map(function (e) { return { date: e.date, count: e.count }; });
    var panel = h('div', { 'class': 'picker__panel' });
    var overlay = h('div', { 'class': 'picker' }, [panel]);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    var status = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
    function say(kind, text) { status.hidden = !text; status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = text || ''; }
    var labelIn = h('input', { 'class': 'table__input', value: (existing && existing.label) || 'Bookings', placeholder: 'Bookings', maxlength: '40' });
    var tbody = h('tbody'), totalEl = h('strong');
    var emptyRow = h('p', { 'class': 'muted', text: 'Nothing logged yet. Add a day, or paste a list.' });
    function total() { return entries.reduce(function (n, e) { return n + (Number(e.count) || 0); }, 0); }
    function drawRows() {
      tbody.innerHTML = '';
      entries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      entries.forEach(function (e, i) {
        var date = h('input', { 'class': 'table__input', type: 'date', value: e.date, onchange: function () { e.date = date.value; } });
        var cnt = h('input', { 'class': 'table__input bk__count', type: 'number', min: '0', step: '1', value: String(e.count), oninput: function () { e.count = Number(cnt.value) || 0; totalEl.textContent = String(total()); } });
        tbody.appendChild(h('tr', {}, [h('td', {}, [date]), h('td', {}, [cnt]), h('td', { 'class': 'table__actions-col' }, [h('button', { 'class': 'btn btn--danger btn--small', type: 'button', onclick: function () { entries.splice(i, 1); drawRows(); } }, ['×'])])]));
      });
      totalEl.textContent = String(total());
      emptyRow.hidden = entries.length > 0;
    }
    function todayIso() { return iso(new Date()); }
    var addBtn = h('button', { 'class': 'btn', type: 'button', onclick: function () { entries.push({ date: todayIso(), count: 1 }); drawRows(); var last = tbody.lastChild && tbody.lastChild.querySelector('input[type=number]'); if (last) { last.focus(); last.select(); } } }, ['+ Add a day']);
    var pasteBtn = h('button', { 'class': 'btn', type: 'button', onclick: function () {
      var text = prompt('Paste lines like "28 Jul 2" or "2026-07-28, 2" (one per line). Rows with the same date add up.');
      if (!text) return;
      var year = new Date().getFullYear(), months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], added = 0;
      text.split(/\r?\n/).forEach(function (line) {
        var m = /(\d{4}-\d{2}-\d{2})\D+(\d+)/.exec(line), date = '', n = 0;
        if (m) { date = m[1]; n = Number(m[2]); }
        else {
          var m2 = /(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\.?(?:\s+(\d{4}))?\D+(\d+)\s*$/.exec(line.trim());
          if (!m2) return;
          var mi = months.indexOf(m2[2].toLowerCase()); if (mi < 0) return;
          date = (m2[3] || year) + '-' + pad(mi + 1) + '-' + pad(Number(m2[1])); n = Number(m2[4]);
        }
        if (!date || !(n >= 0)) return;
        var hit = entries.filter(function (e) { return e.date === date; })[0];
        if (hit) hit.count = (Number(hit.count) || 0) + n; else entries.push({ date: date, count: n });
        added++;
      });
      drawRows();
      say(added ? 'ok' : 'error', added ? added + ' line' + (added === 1 ? '' : 's') + ' added. Save to keep them.' : 'No lines understood. Use "28 Jul 2" or "2026-07-28 2".');
    } }, ['Paste a list']);
    var saveBtn = h('button', { 'class': 'btn btn--primary', type: 'button' }, ['Save']);
    saveBtn.addEventListener('click', function () {
      if (entries.some(function (e) { return !/^\d{4}-\d{2}-\d{2}$/.test(e.date || ''); })) return say('error', 'Every row needs a date.');
      saveBtn.disabled = true; say('', 'Saving…');
      var body = { label: labelIn.value.trim() || 'Bookings', entries: entries.map(function (e) { return { date: e.date, count: Number(e.count) || 0 }; }) };
      if (docId === acct.key) body.client = acct.name; else body.metaAccountId = acct.key;
      request('PUT', '/api/bookings/' + encodeURIComponent(docId), body)
        .then(function () { return request('GET', '/api/bookings'); })
        .then(function (list) { data.bookings = list; close(); render(); }, function (err) { saveBtn.disabled = false; say('error', 'Could not save: ' + err.message); });
    });
    drawRows();
    panel.appendChild(h('div', { 'class': 'picker__head' }, [h('h3', { 'class': 'card__title', text: acct.name + ' · bookings' }), h('button', { 'class': 'btn', type: 'button', onclick: close }, ['Close'])]));
    panel.appendChild(h('p', { 'class': 'muted', text: 'Log this client\'s bookings by day. They count for ' + acct.key + ' and show as the first two metric cards (count and cost per one, from the spend of the switched-on campaigns) for the chosen timeframe.' }));
    panel.appendChild(h('div', { 'class': 'field' }, [h('label', { text: 'Call them' }), labelIn, h('span', { 'class': 'field__hint', text: 'e.g. Bookings, Calls, Appointments. The cost card is named after it.' })]));
    panel.appendChild(h('div', { 'class': 'picker__list bk__list' }, [h('table', { 'class': 'table bk' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Date' }), h('th', { text: 'Count' }), h('th', {})])]), tbody]), emptyRow]));
    panel.appendChild(h('div', { 'class': 'picker__foot' }, [h('div', { 'class': 'btn-row' }, [addBtn, pasteBtn]), h('div', { 'class': 'bk__total' }, [h('span', { 'class': 'muted', text: 'Total ' }), totalEl]), saveBtn]));
    panel.appendChild(status);
    document.body.appendChild(overlay);
  }
  // Bookings logged in the Ad Accounts tab, grouped by the Meta ad account they are tied to ('' = not linked).
  function bookingsByAccount() {
    var out = {};
    ((data && data.bookings) || []).forEach(function (b) {
      if (!b.entries || !b.entries.length) return;
      var k = b.metaAccountId || '';
      var o = out[k] = out[k] || { total: 0, label: b.label || 'Bookings', clients: [] };
      o.total += b.total || 0; o.clients.push(b.client || b.company || 'a client');
    });
    return out;
  }
  function pillRows(tracked) {
    var accounts = [], seen = {}, bk = bookingsByAccount();
    tracked.forEach(function (t) { var k = accountKey(t); if (!seen[k]) { seen[k] = true; accounts.push({ key: k, name: t.adAccountName || t.adAccountId || 'No account', campaigns: [] }); } seen[k] && accounts.filter(function (a) { return a.key === k; })[0].campaigns.push(t); });
    var accRow = h('div', { 'class': 'pills' }, accounts.map(function (a) {
      var on = flag('adbuilder.accountOn.' + a.key);
      var onCount = a.campaigns.filter(function (t) { return campaignOn(t.id); }).length;
      return h('button', { 'class': 'pill' + (on ? ' is-on' : ''), type: 'button', title: (on ? 'Switch off ' : 'Switch on ') + a.name, onclick: function () { setFlag('adbuilder.accountOn.' + a.key, !on); render(); } },
        [h('span', { 'class': 'pill__dot' }), h('span', { text: a.name }), h('span', { 'class': 'pill__count', text: onCount + '/' + a.campaigns.length }), bk[a.key] ? h('span', { 'class': 'pill__bk', text: bk[a.key].total + ' ' + bk[a.key].label.toLowerCase() }) : null]);
    }));
    // Bookings logged for a client whose Meta ad account has no tracked campaigns (or none chosen) can't show up above.
    var orphans = Object.keys(bk).filter(function (k) { return !seen[k]; }).map(function (k) {
      var o = bk[k];
      return o.clients.join(', ') + ': ' + o.total + ' ' + o.label.toLowerCase() + ' logged ' + (k ? 'against ' + k + ', which has no tracked campaigns here' : 'but not linked to a Meta ad account');
    });
    var live = tracked.filter(accountOn);
    var campRow = h('div', { 'class': 'pills pills--campaigns' }, live.map(function (t) {
      var on = campaignOn(t.id);
      return h('button', { 'class': 'pill pill--sm' + (on ? ' is-on' : ''), type: 'button', title: (on ? 'Hide ' : 'Show ') + t.name + ' (' + (t.adAccountName || t.adAccountId || '') + ')', onclick: function () { setOn(t.id, !on); render(); } },
        [h('span', { 'class': 'pill__dot' }), h('span', { text: t.name })]);
    }));
    var r0 = currentRange;
    var bkRow = h('div', { 'class': 'pills' }, accounts.map(function (a) {
      var o = bk[a.key], inFrame = 0;
      if (o && r0) ((data && data.bookings) || []).forEach(function (b) { if (b.metaAccountId === a.key) b.entries.forEach(function (e) { if (e.date >= r0.since && e.date <= r0.until) inFrame += e.count || 0; }); });
      return h('button', { 'class': 'pill pill--sm pill--bk' + (o ? ' is-on' : ''), type: 'button', title: (o ? 'Edit the ' + o.label.toLowerCase() + ' logged for ' : 'Log bookings for ') + a.name, onclick: function () { openBookings(a); } },
        [h('span', { 'class': 'pill__dot' }), h('span', { text: a.name }), h('span', { 'class': 'pill__count', text: o ? inFrame + ' in view · ' + o.total + ' ' + o.label.toLowerCase() + ' total' : '+ log' })]);
    }));
    var wrap = h('div', { 'class': 'pillbox' }, [
      h('div', { 'class': 'pillbox__row' }, [h('span', { 'class': 'mono pillbox__label', text: 'Clients' }), accRow]),
      h('div', { 'class': 'pillbox__row' }, [h('span', { 'class': 'mono pillbox__label', text: 'Bookings' }), bkRow]),
      live.length ? h('div', { 'class': 'pillbox__row' }, [h('span', { 'class': 'mono pillbox__label', text: 'Campaigns' }), campRow]) : h('p', { 'class': 'muted', text: 'Switch a client on to see its campaigns.' }),
      orphans.length ? h('div', { 'class': 'notice notice--warn pillbox__orphans' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: orphans.join('. ') + '. Log them here instead: press the client\'s button in the Bookings row above. (Or in the Ad Accounts tab, press Bookings on that row and pick the Meta ad account.)' })]) : null
    ]);
    return wrap;
  }
  function campaignRow(t, r) {
    var st = t.stats;
    var daily = inRange(withResults(st && st.daily, t.resultOverride), r.since, r.until);
    var m = st ? derive(daily.length ? sum(daily) : (st.daily && st.daily.length ? {} : st.metrics || {})) : {};
    var none = !st;
    var rlabel = campaignResultLabel(t);
    // Result type: auto (what the ad sets optimise for) or a manual choice from the conversions seen.
    var totals = {}; ((st && st.daily) || []).forEach(function (d) { Object.keys(d.conv || {}).forEach(function (k) { totals[k] = (totals[k] || 0) + d.conv[k]; }); });
    ['lead', 'schedule', 'purchase', 'contact', 'complete_registration', 'link_click', 'landing_page_view', 'messaging', 'reach'].forEach(function (k) { if (totals[k] == null) totals[k] = 0; });
    var opt = (st && st.optimisation && st.optimisation[0]) || null;
    var optText = opt ? (opt.customConversionId ? 'custom conversion' : opt.event ? opt.event.toLowerCase().replace(/_/g, ' ') + ' event' : opt.goal.toLowerCase().replace(/_/g, ' ')) : '';
    var autoText = 'Auto: ' + ((st && st.resultType) || 'Results') + (optText ? ' (' + optText + ')' : '');
    var keys = Object.keys(totals).sort(function (a, b) { return (totals[b] || 0) - (totals[a] || 0) || a.localeCompare(b); });
    var resultSel = h('select', { 'class': 'crow__result', title: 'What counts as a result for this campaign' }, [h('option', { value: '', text: autoText })].concat(keys.map(function (k) { return h('option', { value: k, text: labelFor(k, allConvLabels()) + (k === 'reach' ? '' : ' · ' + count(totals[k]) + ' in stored days') }); })));
    resultSel.value = t.resultOverride || '';
    resultSel.addEventListener('change', function () {
      var chosen = resultSel.value;
      request('PUT', '/api/tracked/' + t.id, { resultOverride: chosen }).then(function (o) {
        apply(o);
        if (chosen && !hasConv(t)) { setNotice('', 'The stored numbers predate the conversion breakdown. Pulling fresh data from Meta so ' + labelFor(chosen) + ' can be counted…'); doRefresh(); }
      }, function (err) { setNotice('error', err.message); });
    });
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
        ads.forEach(function (ad) { adsBox.appendChild(adRow(ad, r, rlabel, t.resultOverride)); });
      }
      adsBox.hidden = !open;
      toggle.textContent = (open ? 'Hide ads' : 'Ads') + (ads.length ? ' (' + ads.length + ')' : '');
      toggle.classList.toggle('is-open', open);
    }
    var toggle = h('button', { 'class': 'crow__toggle', type: 'button', onclick: function () { open = !open; try { localStorage.setItem('adbuilder.adsOpen.' + t.id, open ? '1' : '0'); } catch (e) {} drawAds(); } });

    var remove = h('button', { 'class': 'crow__remove', title: 'Stop tracking this campaign', type: 'button', onclick: function () {
      request('DELETE', '/api/tracked/' + t.id).then(function (o) { apply(o); }, function (err) { setNotice('error', err.message); });
    } }, ['×']);
    var card = h('div', { 'class': 'card crow' }, [
      h('div', { 'class': 'crow__main' }, [
        h('div', { 'class': 'crow__id' }, [
          h('div', { 'class': 'crow__name', text: t.name }),
          h('div', { 'class': 'crow__meta' }, [statusBadge(t.status), h('span', { text: (t.adAccountName || t.adAccountId || '') }), h('span', { 'class': 'crow__cid', text: 'ID ' + t.id })]),
          h('div', { 'class': 'crow__actions' }, [toggle, resultSel]),
          h('div', { 'class': 'crow__label', text: st ? 'Synced ' + ago(st.syncedAt) : 'No data yet' }),
          st ? metaSays(t) : null
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
  function openPicker(startMode) {
    var mode = startMode || (data.tracked.length ? 'add' : 'add');
    var chosenAccounts = {}; data.tracked.forEach(function (t) { if (t.adAccountId) chosenAccounts[t.adAccountId] = true; });
    var chosen = {};                 // add mode: new campaigns to append
    var keep = {}; data.tracked.forEach(function (t) { keep[t.id] = true; });   // edit mode: which existing ones stay
    var tracked = {}; data.tracked.forEach(function (t) { tracked[t.id] = t; });
    var step = 1, requestedAt = 0, waiting = false;
    var panel = h('div', { 'class': 'picker__panel picker__panel--wide' });
    var overlay = h('div', { 'class': 'picker' }, [panel]);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    var status = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
    function say(kind, text) { status.hidden = !text; status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = text || ''; }
    function head() {
      var tabs = h('div', { 'class': 'ptabs' }, [['add', 'Add new campaigns'], ['edit', 'Edit existing campaigns']].map(function (t) {
        return h('button', { 'class': 'ptabs__tab' + (mode === t[0] ? ' is-on' : ''), type: 'button', onclick: function () { mode = t[0]; step = 1; say('', ''); draw(); } }, [t[1] + (t[0] === 'edit' ? ' (' + data.tracked.length + ')' : '')]);
      }));
      return h('div', { 'class': 'picker__head' }, [
        h('div', {}, [tabs,
          mode === 'add' ? h('div', { 'class': 'steps' }, [1, 2].map(function (n) { return h('span', { 'class': 'steps__item' + (n === step ? ' is-on' : n < step ? ' is-done' : ''), text: n + ' ' + ['Ad accounts', 'Pick campaigns'][n - 1] }); })) : null]),
        h('button', { 'class': 'btn', type: 'button', onclick: function () { overlay.remove(); } }, ['Close'])
      ]);
    }
    function draw() { panel.innerHTML = ''; panel.appendChild(head()); panel.appendChild(status); (mode === 'edit' ? drawEdit : step === 1 ? drawAccounts : drawCampaigns)(); }

    // Edit mode: the campaigns already on the dashboard; untick to remove, change the result type inline.
    function drawEdit() {
      panel.appendChild(h('p', { 'class': 'muted', text: 'These campaigns are on the dashboard. Untick one to remove it (its stored numbers are dropped). Use "Add new campaigns" to bring more in.' }));
      var list = h('div', { 'class': 'picker__list' });
      var countEl = h('span', { 'class': 'muted' });
      function drawList() {
        list.innerHTML = '';
        if (!data.tracked.length) list.appendChild(h('p', { 'class': 'muted', text: 'Nothing on the dashboard yet.' }));
        data.tracked.forEach(function (t) {
          var box = h('input', { type: 'checkbox', checked: !!keep[t.id] });
          var item = h('label', { 'class': 'picker__item' + (keep[t.id] ? ' is-added' : '') }, [box,
            h('div', { 'class': 'picker__text' }, [h('strong', { text: t.name }), h('span', { text: (t.adAccountName || t.adAccountId || '') + ' · ID ' + t.id + (t.status ? ' · ' + t.status : '') + (t.stats ? ' · result: ' + campaignResultLabel(t) : ' · no numbers yet') })]),
            h('span', { 'class': 'picker__show', text: keep[t.id] ? 'Keep' : 'Remove' })]);
          box.addEventListener('change', function () { keep[t.id] = box.checked; item.classList.toggle('is-added', box.checked); item.lastChild.textContent = box.checked ? 'Keep' : 'Remove'; countEl.textContent = Object.keys(keep).filter(function (k) { return keep[k]; }).length + ' will stay'; });
          list.appendChild(item);
        });
        countEl.textContent = Object.keys(keep).filter(function (k) { return keep[k]; }).length + ' will stay';
      }
      var save = h('button', { 'class': 'btn btn--primary', type: 'button', onclick: function () {
        var remaining = data.tracked.filter(function (t) { return keep[t.id]; });
        var removed = data.tracked.length - remaining.length;
        if (removed && !confirm('Remove ' + removed + ' campaign' + (removed === 1 ? '' : 's') + ' from the dashboard?')) return;
        save.disabled = true;
        request('PUT', '/api/tracked', { campaigns: remaining })
          .then(function (o) { overlay.remove(); apply(o); setNotice('ok', o.tracked.length + ' campaign' + (o.tracked.length === 1 ? '' : 's') + ' on the dashboard.'); }, function (err) { save.disabled = false; say('error', err.message); });
      } }, ['Save changes']);
      panel.appendChild(list);
      panel.appendChild(h('div', { 'class': 'picker__foot' }, [countEl, save]));
      drawList();
    }

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
      var catalog = (data.catalog.items || []).filter(function (c) { return !tracked[c.id] && (!selectedAccounts.length || !c.adAccountId || selectedAccounts.indexOf(c.adAccountId) !== -1); });
      var names = {}; (data.accounts || []).forEach(function (a) { names[a.id] = a.name; });
      var already = (data.catalog.items || []).filter(function (c) { return tracked[c.id] && (!selectedAccounts.length || !c.adAccountId || selectedAccounts.indexOf(c.adAccountId) !== -1); }).length;
      panel.appendChild(h('p', { 'class': 'muted', text: 'Tick the campaigns to add to the dashboard. They join the ' + data.tracked.length + ' already there' + (already ? ' (' + already + ' from these accounts are hidden because they are already on it)' : '') + '. Only dashboard campaigns are pulled from Meta.' }));
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
              h('span', { 'class': 'picker__show', text: chosen[c.id] ? 'Adding' : 'Add' })]);
            box.addEventListener('change', function () { if (box.checked) chosen[c.id] = c; else delete chosen[c.id]; item.classList.toggle('is-added', box.checked); item.lastChild.textContent = box.checked ? 'Adding' : 'Add'; countEl.textContent = selectedCount() + ' to add'; });
            list.appendChild(item);
          });
        });
        if (!list.children.length) {
          list.appendChild(h('p', { 'class': 'muted', text: waiting ? 'Waiting for Hermes to send the campaign list…' : catalog.length ? 'Nothing matches.' : already ? 'Every campaign from these accounts is already on the dashboard.' : 'No campaigns synced for these accounts yet. Go back and press "Pull campaigns", or add one by ID below.' }));
          if (waiting || !catalog.length) list.appendChild(diagnostics());
        }
        countEl.textContent = selectedCount() + ' to add';
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
        var adding = Object.keys(chosen).map(function (id) { return chosen[id]; });
        if (!adding.length) { say('error', 'Tick at least one campaign to add.'); return; }
        save.disabled = true;
        request('PUT', '/api/tracked', { campaigns: data.tracked.concat(adding) })
          .then(function (o) { overlay.remove(); apply(o); setNotice('ok', adding.length + ' campaign' + (adding.length === 1 ? '' : 's') + ' added (' + o.tracked.length + ' on the dashboard). Pulling their numbers…'); doRefresh(); }, function (err) { save.disabled = false; say('error', err.message); });
      } }, ['Add to dashboard']);
      panel.appendChild(search); panel.appendChild(list);
      panel.appendChild(h('div', { 'class': 'picker__manual' }, [manualId, manualName, manualAdd]));
      panel.appendChild(h('div', { 'class': 'picker__foot' }, [h('div', { 'class': 'btn-row' }, [back, countEl]), save]));
      drawList();
    }
    document.body.appendChild(overlay);
    draw();
  }

  // ---- metrics chooser: up to 15 from the catalogue, in the order they will appear ----
  function openMetrics() {
    var chosen = ((data && data.dashboard && data.dashboard.metrics) || []).filter(function (k) { return BY_KEY[k]; });
    var panel = h('div', { 'class': 'picker__panel picker__panel--wide' });
    var overlay = h('div', { 'class': 'picker' }, [panel]);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    var countEl = h('span', { 'class': 'mono' });
    var status = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
    function say(kind, text) { status.hidden = !text; status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = text || ''; }
    var selected = h('div', { 'class': 'mlist' });
    var catalog = h('div', { 'class': 'mcat' });
    var search = h('input', { 'class': 'table__input', type: 'search', placeholder: 'Search metrics…' });
    function drawSelected() {
      selected.innerHTML = '';
      countEl.textContent = chosen.length + ' / ' + MAX_METRICS + ' chosen · shown in this order';
      if (!chosen.length) selected.appendChild(h('p', { 'class': 'muted', text: 'Nothing chosen yet. Tick metrics on the right.' }));
      chosen.forEach(function (k, i) {
        var c = BY_KEY[k];
        selected.appendChild(h('div', { 'class': 'mlist__row' }, [
          h('span', { 'class': 'mono', text: pad(i + 1) }), h('span', { 'class': 'mlist__name', text: c.label }), h('span', { 'class': 'mono mlist__group', text: c.g }),
          h('button', { 'class': 'mlist__btn', type: 'button', title: 'Move up', disabled: i === 0, onclick: function () { chosen.splice(i - 1, 0, chosen.splice(i, 1)[0]); drawSelected(); } }, ['▲']),
          h('button', { 'class': 'mlist__btn', type: 'button', title: 'Move down', disabled: i === chosen.length - 1, onclick: function () { chosen.splice(i + 1, 0, chosen.splice(i, 1)[0]); drawSelected(); } }, ['▼']),
          h('button', { 'class': 'mlist__btn mlist__btn--x', type: 'button', title: 'Remove', onclick: function () { chosen.splice(i, 1); drawSelected(); drawCatalog(); } }, ['×'])
        ]));
      });
    }
    function drawCatalog() {
      catalog.innerHTML = '';
      var q = search.value.trim().toLowerCase();
      var groups = [];
      CATALOG.forEach(function (c) { if (q && (c.label + ' ' + c.g).toLowerCase().indexOf(q) === -1) return; if (groups.indexOf(c.g) === -1) groups.push(c.g); });
      groups.forEach(function (g) {
        catalog.appendChild(h('div', { 'class': 'picker__group', text: g }));
        CATALOG.filter(function (c) { return c.g === g && (!q || (c.label + ' ' + c.g).toLowerCase().indexOf(q) !== -1); }).forEach(function (c) {
          var on = chosen.indexOf(c.key) !== -1;
          var full = !on && chosen.length >= MAX_METRICS;
          var box = h('input', { type: 'checkbox', checked: on, disabled: full });
          var item = h('label', { 'class': 'mcat__item' + (on ? ' is-added' : '') + (full ? ' is-full' : '') }, [box, h('span', { text: c.label })]);
          box.addEventListener('change', function () {
            if (box.checked) { if (chosen.length >= MAX_METRICS) { box.checked = false; say('error', 'Maximum ' + MAX_METRICS + ' metrics. Remove one first.'); return; } chosen.push(c.key); }
            else chosen.splice(chosen.indexOf(c.key), 1);
            say('', ''); drawSelected(); drawCatalog();
          });
          catalog.appendChild(item);
        });
      });
      if (!catalog.children.length) catalog.appendChild(h('p', { 'class': 'muted', text: 'Nothing matches.' }));
    }
    search.addEventListener('input', drawCatalog);
    var save = h('button', { 'class': 'btn btn--primary', type: 'button', onclick: function () {
      if (!chosen.length) { say('error', 'Choose at least one metric.'); return; }
      save.disabled = true;
      request('PUT', '/api/dashboard', { metrics: chosen }).then(function (dash) { data.dashboard = dash; overlay.remove(); render(); setNotice('ok', dash.metrics.length + ' metrics on the dashboard.'); }, function (err) { save.disabled = false; say('error', err.message); });
    } }, ['Save metrics']);
    var reset = h('button', { 'class': 'btn', type: 'button', onclick: function () { chosen = ['spend', 'results', 'costPerResult', 'impressions', 'reach', 'cpm', 'cplc', 'ctrAll', 'linkCtr', 'frequency']; drawSelected(); drawCatalog(); } }, ['Reset to default']);
    panel.appendChild(h('div', { 'class': 'picker__head' }, [h('div', {}, [h('h2', { 'class': 'card__title', text: 'Choose metrics', style: 'margin:0' }), h('div', { 'class': 'muted', text: 'Everything Ads Manager reports that this page pulls. Up to ' + MAX_METRICS + ' at a time, shared by everyone who opens the dashboard.' })]), h('button', { 'class': 'btn', type: 'button', onclick: function () { overlay.remove(); } }, ['Close'])]));
    panel.appendChild(status);
    panel.appendChild(h('div', { 'class': 'mgrid' }, [
      h('div', { 'class': 'mgrid__col' }, [countEl, selected]),
      h('div', { 'class': 'mgrid__col' }, [search, catalog])
    ]));
    panel.appendChild(h('div', { 'class': 'picker__foot' }, [reset, save]));
    document.body.appendChild(overlay);
    drawSelected(); drawCatalog();
  }

  // ---- page ----
  var data = null, notice = h('div', { 'class': 'notice', hidden: '' }, [h('span', { 'class': 'notice__dot' }), h('span')]);
  function setNotice(kind, text) { notice.hidden = !text; notice.className = 'notice' + (kind ? ' notice--' + kind : ''); notice.lastChild.textContent = text || ''; }
  var body = h('div', {});
  var refreshBtn = h('button', { 'class': 'btn btn--primary', type: 'button', onclick: doRefresh }, ['Refresh']);
  var chooseBtn = h('button', { 'class': 'btn', type: 'button', onclick: function () { if (data) openPicker('add'); } }, ['Add campaigns']);
  var editBtn = h('button', { 'class': 'btn', type: 'button', onclick: function () { if (data) openPicker('edit'); } }, ['Edit campaigns']);
  var subtitle = h('div', { 'class': 'muted' });
  var frameSel = h('select', { 'class': 'table__input frame__select', title: 'Timeframe' }, PRESETS.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
  var sinceIn = h('input', { 'class': 'table__input frame__date', type: 'date' });
  var untilIn = h('input', { 'class': 'table__input frame__date', type: 'date' });
  var customBox = h('div', { 'class': 'frame__custom', hidden: '' }, [sinceIn, h('span', { 'class': 'muted', text: 'to' }), untilIn]);
  function saveFrame() { try { localStorage.setItem('adbuilder.timeframe', JSON.stringify(frame)); } catch (e) {} }
  frameSel.value = frame.preset; sinceIn.value = frame.since || ''; untilIn.value = frame.until || '';
  customBox.hidden = frame.preset !== 'custom';
  frameSel.addEventListener('change', function () { creativePage = 0; frame.preset = frameSel.value; customBox.hidden = frame.preset !== 'custom'; if (frame.preset === 'custom' && !frame.since) { frame.since = dayKey(6); frame.until = dayKey(0); sinceIn.value = frame.since; untilIn.value = frame.until; } saveFrame(); if (data) render(); });
  [sinceIn, untilIn].forEach(function (inp) { inp.addEventListener('change', function () { frame.since = sinceIn.value; frame.until = untilIn.value; saveFrame(); if (data) render(); }); });
  root.appendChild(h('div', { 'class': 'perf-toolbar' }, [
    h('div', {}, [h('h2', { 'class': 'card__title', text: 'Current campaigns', style: 'margin:0' }), subtitle]),
    h('div', { 'class': 'btn-row perf-toolbar__right' }, [h('div', { 'class': 'frame' }, [frameSel, customBox]), h('button', { 'class': 'btn', type: 'button', onclick: openMetrics }, ['Metrics']), chooseBtn, editBtn, refreshBtn])
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
        h('p', { 'class': 'muted', text: 'Press "Add campaigns" to pick the Meta campaigns to show. Only those are pulled, at 8:00 and 15:00 Adelaide time and whenever you press Refresh.' }),
        h('p', { 'class': 'muted', text: 'Step 1 picks the ad accounts, step 2 asks Hermes for their campaign list, step 3 ticks what shows here.' })
      ]));
      return;
    }
    var r = rangeOf(frame);
    currentRange = r;
    var on = d.tracked.filter(function (t) { return isOn(t.id); });
    var sr = series(on, r);
    body.appendChild(h('div', { 'class': 'con__head mono' }, [h('span', { text: 'Campaigns · ' + pad(on.length) + ' / ' + pad(d.tracked.length) + ' on' }), h('span', { text: r.label + ' · ' + (d.source === 'meta' ? 'direct from Meta' : 'via Hermes') + ' · changes vs ' + compareLabel(r) })]));
    body.appendChild(pillRows(d.tracked));
    if (!on.length) { body.appendChild(h('div', { 'class': 'card perf-empty' }, [h('h3', { text: 'Nothing switched on' }), h('p', { 'class': 'muted', text: 'Switch on a client and at least one campaign above.' })])); return; }
    body.appendChild(hero(sr, r, on));
    body.appendChild(summaryCards(sr, r, on));
    body.appendChild(bestCreatives(on, r));
    body.appendChild(h('div', { 'class': 'crow-head' }, [h('span', { text: 'Campaigns' }), h('span', { 'class': 'muted', text: on.length + ' shown · use the pills above to switch clients and campaigns · ' + (d.source === 'meta' ? 'pulled straight from Meta' : d.pending ? 'waiting for Hermes to send new numbers…' : 'numbers as sent by Hermes') })]));
    on.forEach(function (t) { body.appendChild(campaignRow(t, r)); });
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
