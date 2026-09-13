// Campaign performance: which Meta campaigns are tracked, their numbers, and how they get refreshed.
//
// Flow
//   1. Hermes syncs the list of Meta campaigns in   (PUT /api/v1/meta { campaigns: [...] })
//   2. The user picks which ones to track            (PUT /api/tracked { campaigns: [{ id, name, adAccountId }] })
//   3. A refresh sends ONE webhook to Hermes naming only those campaigns (Refresh button, or the
//      cron at 8:00 and 15:00 Adelaide time)          (POST /api/tracked/refresh, GET /api/cron/stats)
//   4. Hermes pulls the insights from Meta and pushes them back
//      (PUT /api/v1/campaign-stats { items: [{ campaignId, metrics, daily }] })

var docs = require('./docs');
var hermes = require('./hermes');

var MAX_TRACKED = 100;
var DAYS = 60;                       // daily series kept per campaign (30 days shown + 30 for the comparison)
var REFRESH_COOLDOWN_MS = 60 * 1000; // Refresh presses closer together than this are ignored (Meta rate limits)
var TZ = 'Australia/Adelaide';

function str(v, max) { return String(v == null ? '' : v).slice(0, max || 200); }
function num(v) { var n = Number(String(v == null ? '' : v).replace(/[,$\s]/g, '')); return isFinite(n) ? n : 0; }
function has(v) { return v != null && v !== ''; }

// ---- Tracked campaigns ----
function cleanTracked(input) {
  if (!input || typeof input !== 'object') return null;
  var id = str(input.id || input.campaignId || input.campaign_id, 64).trim();
  if (!/^[0-9]{5,30}$/.test(id)) return null;
  return {
    id: id,
    name: str(input.name, 200).trim() || 'Campaign ' + id,
    adAccountId: str(input.adAccountId || input.ad_account_id || input.account_id, 40).trim(),
    adAccountName: str(input.adAccountName || input.ad_account_name || input.account_name, 200).trim(),
    status: str(input.status, 40).trim(),
    objective: str(input.objective, 80).trim()
  };
}
function listTracked() {
  return docs.list('tracked').then(function (rows) {
    return rows.sort(function (a, b) { return (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt; });
  });
}
// Replaces the tracked set. Stats of campaigns that stay tracked are kept; removed ones lose their stats.
function setTracked(list) {
  var items = (Array.isArray(list) ? list : []).map(cleanTracked).filter(Boolean);
  var seen = {}; items = items.filter(function (i) { if (seen[i.id]) return false; seen[i.id] = true; return true; }).slice(0, MAX_TRACKED);
  return listTracked().then(function (existing) {
    var keep = {}; items.forEach(function (i) { keep[i.id] = true; });
    var gone = existing.filter(function (e) { return !keep[e.id]; });
    var byId = {}; existing.forEach(function (e) { byId[e.id] = e; });
    return items.reduce(function (chain, item, index) {
      return chain.then(function () {
        var prev = byId[item.id] || {};
        return docs.put('tracked', item.id, Object.assign({}, prev, item, { order: index, addedAt: prev.addedAt || Date.now() }));
      });
    }, Promise.resolve()).then(function () {
      return gone.reduce(function (chain, g) { return chain.then(function () { return docs.remove('tracked', g.id).then(function () { return docs.remove('stats', g.id); }); }); }, Promise.resolve());
    });
  }).then(listTracked);
}

// ---- Stats pushed in by Hermes ----
var METRICS = ['spend', 'revenue', 'purchases', 'leads', 'newLeads', 'clicks', 'impressions', 'reach', 'calls', 'refunds', 'refundAmount'];
var ALIASES = {
  spend: ['spend', 'cost', 'amount_spent'], revenue: ['revenue', 'purchase_value', 'conversion_value', 'value', 'sales_value'],
  purchases: ['purchases', 'sales', 'conversions', 'results'], leads: ['leads', 'lead'], newLeads: ['newLeads', 'new_leads'],
  clicks: ['clicks', 'link_clicks', 'inline_link_clicks'], impressions: ['impressions'], reach: ['reach'], calls: ['calls', 'phone_calls'],
  refunds: ['refunds', 'refund_count'], refundAmount: ['refundAmount', 'refund_amount', 'refund']
};
function pick(obj, key) {
  var names = ALIASES[key] || [key];
  for (var i = 0; i < names.length; i++) if (obj && has(obj[names[i]])) return num(obj[names[i]]);
  return null;
}
function cleanMetrics(obj) {
  var out = {}; METRICS.forEach(function (k) { var v = pick(obj, k); if (v != null) out[k] = v; });
  return out;
}
function cleanDaily(list) {
  if (!Array.isArray(list)) return [];
  var byDate = {};
  list.forEach(function (d) {
    if (!d || typeof d !== 'object') return;
    var date = str(d.date || d.date_start || d.day, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    byDate[date] = Object.assign({ date: date }, cleanMetrics(d));
  });
  return Object.keys(byDate).sort().slice(-DAYS).map(function (k) { return byDate[k]; });
}
function sumDaily(daily) {
  var out = {}; daily.forEach(function (d) { METRICS.forEach(function (k) { if (has(d[k])) out[k] = (out[k] || 0) + d[k]; }); });
  return out;
}
function cleanStatsItem(item) {
  if (!item || typeof item !== 'object') return null;
  var id = str(item.campaignId || item.campaign_id || item.id, 64).trim();
  if (!/^[0-9]{5,30}$/.test(id)) return null;
  var daily = cleanDaily(item.daily || item.days || item.series);
  var metrics = cleanMetrics(item.metrics || item.totals || item);
  if (!Object.keys(metrics).length && daily.length) metrics = sumDaily(daily);
  return {
    id: id,
    name: str(item.name || item.campaign_name, 200).trim(),
    status: str(item.status || item.effective_status, 40).trim(),
    currency: str(item.currency, 10).trim(),
    period: item.period && typeof item.period === 'object' ? { since: str(item.period.since, 10), until: str(item.period.until, 10) } : null,
    metrics: metrics,
    daily: daily,
    syncedAt: Date.now()
  };
}
// Stores what Hermes sent; only tracked campaigns are accepted (anything else is reported back as skipped).
function storeStats(body) {
  var list = Array.isArray(body) ? body : body && (body.items || body.campaigns || body.stats);
  if (!Array.isArray(list)) return Promise.reject(Object.assign(new Error('Send { items: [{ campaignId, metrics: {...}, daily: [{ date, spend, ... }] }] }.'), { code: 'BAD_INPUT' }));
  return listTracked().then(function (tracked) {
    var byId = {}; tracked.forEach(function (t) { byId[t.id] = t; });
    var stored = [], skipped = [];
    return list.reduce(function (chain, raw) {
      return chain.then(function () {
        var item = cleanStatsItem(raw);
        if (!item) { skipped.push(raw && (raw.campaignId || raw.id) || '?'); return; }
        if (!byId[item.id]) { skipped.push(item.id); return; }
        stored.push(item.id);
        var t = byId[item.id];
        var patch = {};
        if (item.name && item.name !== t.name) patch.name = item.name;
        if (item.status && item.status !== t.status) patch.status = item.status;
        return docs.put('stats', item.id, item).then(function () {
          if (Object.keys(patch).length) return docs.put('tracked', t.id, Object.assign({}, t, patch));
        });
      });
    }, Promise.resolve()).then(function () {
      return docs.get('settings', 'stats').then(function (s) {
        s = s || {};
        s.lastDataAt = Date.now(); s.lastDataCount = stored.length;
        if (s.pending) s.pending = null;
        return docs.put('settings', 'stats', s);
      }).then(function () { return { stored: stored, skipped: skipped }; });
    });
  });
}

// ---- What the page reads ----
function schedule() {
  // Next 8:00 / 15:00 Adelaide time, computed from the wall clock in that zone.
  var now = new Date();
  var parts = {};
  new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(now).forEach(function (p) { parts[p.type] = p.value; });
  var hour = Number(parts.hour) % 24, minute = Number(parts.minute);
  var minutes = hour * 60 + minute;
  var slots = [8 * 60, 15 * 60];
  var nextSlot = null, addDay = 0;
  for (var i = 0; i < slots.length; i++) if (slots[i] > minutes) { nextSlot = slots[i]; break; }
  if (nextSlot == null) { nextSlot = slots[0]; addDay = 1; }
  var wait = nextSlot - minutes + addDay * 24 * 60;
  return { timeZone: TZ, times: ['08:00', '15:00'], nextAt: new Date(now.getTime() + wait * 60000).toISOString(), localNow: parts.hour + ':' + parts.minute };
}
// Ad accounts Hermes can pull from: the synced Meta catalog plus any "act=" ids found in the Ad Accounts tab.
function knownAccounts() {
  var accounts = require('./store');
  return Promise.all([docs.get('meta', 'adAccounts'), accounts.list()]).then(function (r) {
    var out = [], seen = {};
    ((r[0] && r[0].items) || []).forEach(function (a) { if (a.id && !seen[a.id]) { seen[a.id] = true; out.push({ id: a.id, name: a.name || a.id, source: 'meta' }); } });
    (r[1] || []).forEach(function (row) {
      var m = /[?&]act=(\d+)/.exec(String(row.link || '')) || /act_(\d+)/.exec(String(row.link || ''));
      if (!m) return;
      var id = 'act_' + m[1];
      if (seen[id]) return;
      seen[id] = true; out.push({ id: id, name: (row.client || '') + (row.company ? ' (' + row.company + ')' : '') || id, source: 'table' });
    });
    return out;
  });
}
function overview() {
  return Promise.all([listTracked(), docs.list('stats'), docs.get('settings', 'stats'), docs.get('meta', 'campaigns'), hermes.config(), knownAccounts()]).then(function (r) {
    var stats = {}; r[1].forEach(function (s) { stats[s.id] = s; });
    var settings = r[2] || {};
    return {
      tracked: r[0].map(function (t) { var s = stats[t.id]; return Object.assign({}, t, { stats: s ? { metrics: s.metrics, daily: s.daily, currency: s.currency, period: s.period, syncedAt: s.syncedAt } : null }); }),
      catalog: { items: (r[3] && r[3].items) || [], syncedAt: r[3] ? r[3].syncedAt || null : null },
      accounts: r[5],
      pendingCatalog: settings.pendingCatalog || null,
      lastRefresh: settings.lastRefresh || null,
      lastDataAt: settings.lastDataAt || null,
      pending: settings.pending || null,
      hermesConfigured: !!(r[4].url && (r[4].auth === 'hmac' ? r[4].secret : r[4].key)),
      cronConfigured: !!process.env.CRON_SECRET,
      schedule: schedule()
    };
  });
}

// ---- Asking Hermes for fresh numbers (one webhook naming only the tracked campaigns) ----
function today(offsetDays) {
  var d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}
function refreshPrompt(tracked, reportUrl) {
  var p = [];
  p.push('Pull Meta Ads performance for the campaigns listed below and ONLY those campaigns. Do not query any other campaign, ad set, or ad; keep the number of Meta API calls as low as possible (one insights call per campaign with a daily breakdown is enough).');
  p.push('');
  p.push('CAMPAIGNS:');
  tracked.forEach(function (t, i) { p.push((i + 1) + '. ' + t.name + ' — campaign ID ' + t.id + (t.adAccountId ? ' (ad account ' + t.adAccountId + ')' : '')); });
  p.push('');
  p.push('PERIOD: ' + today(-(DAYS - 1)) + ' to ' + today(0) + ' (daily breakdown).');
  p.push('METRICS PER DAY: spend, impressions, reach, clicks (link clicks), leads (lead results), purchases, revenue (purchase conversion value), and calls if the campaign tracks them.');
  p.push('');
  p.push('Then send the numbers to AdBuilder with the ADBUILDER_API_KEY (header "Authorization: Bearer <key>"):');
  p.push('PUT ' + reportUrl);
  p.push('{ "items": [ { "campaignId": "<id>", "name": "<name>", "status": "<ACTIVE|PAUSED|...>", "currency": "<AUD>",');
  p.push('              "daily": [ { "date": "YYYY-MM-DD", "spend": 0, "impressions": 0, "reach": 0, "clicks": 0, "leads": 0, "purchases": 0, "revenue": 0 } ] } ] }');
  p.push('Send every campaign in one request. Reply with which campaigns were updated and any that could not be read.');
  return p.join('\n');
}
function refresh(source, baseUrl) {
  return Promise.all([listTracked(), hermes.config(), docs.get('settings', 'stats')]).then(function (r) {
    var tracked = r[0], cfg = r[1], settings = r[2] || {};
    if (!tracked.length) { var e0 = new Error('No campaigns are being tracked yet. Choose campaigns first.'); e0.code = 'NOTHING_TRACKED'; throw e0; }
    var last = settings.lastRefresh && settings.lastRefresh.at || 0;
    if (source === 'manual' && Date.now() - last < REFRESH_COOLDOWN_MS) {
      var e1 = new Error('A refresh was requested ' + Math.round((Date.now() - last) / 1000) + ' s ago. Wait a minute before asking Hermes again.'); e1.code = 'COOLDOWN'; throw e1;
    }
    var base = cfg.publicBaseUrl || baseUrl || '';
    var reportUrl = base + '/api/v1/campaign-stats';
    var body = {
      event: 'adbuilder.stats.refresh', event_type: 'adbuilder.stats.refresh', source: 'adbuilder', trigger: source, sentAt: new Date().toISOString(),
      prompt: refreshPrompt(tracked, reportUrl),
      campaigns: tracked.map(function (t) { return { id: t.id, name: t.name, adAccountId: t.adAccountId }; }),
      period: { since: today(-(DAYS - 1)), until: today(0) },
      reportUrl: reportUrl
    };
    return hermes.send(cfg, body, 'adbuilder.stats.refresh').then(function (reply) {
      var record = { at: Date.now(), source: source, campaigns: tracked.length, status: reply.status, ok: reply.ok, reply: reply.body, error: reply.ignored || undefined };
      settings.lastRefresh = record;
      settings.pending = reply.ok ? { since: record.at, campaigns: tracked.length } : null;
      return docs.put('settings', 'stats', settings).then(function () { return record; });
    }, function (err) {
      settings.lastRefresh = { at: Date.now(), source: source, campaigns: tracked.length, status: 0, ok: false, error: err.message };
      return docs.put('settings', 'stats', settings).then(function () { throw err; });
    });
  });
}

// ---- Asking Hermes for the campaign list of chosen ad accounts (or for the ad account list itself) ----
var SYNC_COOLDOWN_MS = 30 * 1000;
function syncPrompt(kind, accounts, metaUrl) {
  var p = [];
  if (kind === 'accounts') {
    p.push('List the Meta ad accounts the connected Meta token can access (id, name, currency, account status). Do not pull campaigns or insights.');
    p.push('');
    p.push('Then send them to AdBuilder with the ADBUILDER_API_KEY (header "Authorization: Bearer <key>"):');
    p.push('PUT ' + metaUrl);
    p.push('{ "adAccounts": [ { "id": "act_<id>", "name": "<name>", "currency": "<AUD>", "status": "<status>" } ] }');
    p.push('If pixels/datasets and pages are cheap to list, include "pixels": [{ "id", "name" }] and "pages": [{ "id", "name" }] in the same request.');
  } else {
    p.push('List the campaigns in the Meta ad accounts below and ONLY those accounts (one campaigns call per account; include paused and archived-but-recent campaigns; fields: id, name, status/effective_status, objective). Do not pull insights or ad sets.');
    p.push('');
    p.push('AD ACCOUNTS:');
    accounts.forEach(function (a, i) { p.push((i + 1) + '. ' + a.name + ' — ' + a.id); });
    p.push('');
    p.push('Then send them to AdBuilder with the ADBUILDER_API_KEY (header "Authorization: Bearer <key>"):');
    p.push('PUT ' + metaUrl);
    p.push('{ "campaigns": [ { "id": "<campaign id>", "name": "<name>", "adAccountId": "act_<id>", "adAccountName": "<account name>", "status": "<ACTIVE|PAUSED|...>", "objective": "<objective>" } ] }');
    p.push('Send every campaign of every listed account in one request. Reply with how many campaigns were sent per account.');
  }
  return p.join('\n');
}
function syncCatalog(accountIds, baseUrl) {
  return Promise.all([knownAccounts(), hermes.config(), docs.get('settings', 'stats')]).then(function (r) {
    var known = r[0], cfg = r[1], settings = r[2] || {};
    var last = settings.lastCatalogRequest && settings.lastCatalogRequest.at || 0;
    if (Date.now() - last < SYNC_COOLDOWN_MS) { var e1 = new Error('Hermes was asked ' + Math.round((Date.now() - last) / 1000) + ' s ago. Give it a moment.'); e1.code = 'COOLDOWN'; throw e1; }
    var wanted = Array.isArray(accountIds) && accountIds.length ? known.filter(function (a) { return accountIds.indexOf(a.id) !== -1; }) : known;
    var kind = wanted.length ? 'campaigns' : 'accounts';
    var base = cfg.publicBaseUrl || baseUrl || '';
    var metaUrl = base + '/api/v1/meta';
    var event = kind === 'accounts' ? 'adbuilder.accounts.sync' : 'adbuilder.campaigns.sync';
    var body = {
      event: event, event_type: event, source: 'adbuilder', sentAt: new Date().toISOString(),
      prompt: syncPrompt(kind, wanted, metaUrl),
      accounts: wanted.map(function (a) { return { id: a.id, name: a.name }; }),
      reportUrl: metaUrl
    };
    return hermes.send(cfg, body, event).then(function (reply) {
      var record = { at: Date.now(), kind: kind, accounts: wanted.map(function (a) { return a.id; }), status: reply.status, ok: reply.ok, reply: reply.body, error: reply.ignored || undefined };
      settings.pendingCatalog = reply.ok ? record : null;
      settings.lastCatalogRequest = record;
      return docs.put('settings', 'stats', settings).then(function () { return record; });
    });
  });
}
function catalogArrived() {
  return docs.get('settings', 'stats').then(function (s) { if (s && s.pendingCatalog) { s.pendingCatalog = null; return docs.put('settings', 'stats', s); } });
}

module.exports = { syncCatalog: syncCatalog, catalogArrived: catalogArrived, knownAccounts: knownAccounts, listTracked: listTracked, setTracked: setTracked, storeStats: storeStats, overview: overview, refresh: refresh, schedule: schedule, refreshPrompt: refreshPrompt, cleanStatsItem: cleanStatsItem, DAYS: DAYS };
