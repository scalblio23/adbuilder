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
var meta = require('./meta');

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
    objective: str(input.objective, 80).trim(),
    resultOverride: str(input.resultOverride, 40).trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
  };
}
// Per-campaign choice of what counts as a result ("" = follow the ad sets' optimisation).
function setResultOverride(id, key) {
  return docs.get('tracked', id).then(function (t) {
    if (!t) return null;
    return docs.put('tracked', id, Object.assign({}, t, { resultOverride: str(key, 40).trim().toLowerCase().replace(/[^a-z0-9_]/g, '') }));
  });
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
var METRICS = ['spend', 'impressions', 'reach', 'clicksAll', 'linkClicks', 'uniqueClicks', 'uniqueLinkClicks', 'outboundClicks', 'landingPageViews', 'results', 'revenue', 'purchases', 'leads', 'newLeads', 'calls', 'refunds', 'refundAmount',
  'postEngagement', 'pageEngagement', 'reactions', 'comments', 'shares', 'saves', 'pageLikes', 'videoPlays', 'videoViews3s', 'thruplays', 'videoP25', 'videoP50', 'videoP75', 'videoP100', 'messaging', 'socialSpend'];
var ALIASES = {
  spend: ['spend', 'cost', 'amount_spent'], impressions: ['impressions'], reach: ['reach'],
  clicksAll: ['clicksAll', 'clicks_all', 'all_clicks', 'clicks'], linkClicks: ['linkClicks', 'link_clicks', 'inline_link_clicks'],
  uniqueClicks: ['uniqueClicks', 'unique_clicks'], uniqueLinkClicks: ['uniqueLinkClicks', 'unique_link_clicks', 'unique_inline_link_clicks'], outboundClicks: ['outboundClicks', 'outbound_clicks'],
  landingPageViews: ['landingPageViews', 'landing_page_views'],
  results: ['results', 'result'],
  revenue: ['revenue', 'purchase_value', 'conversion_value', 'value', 'sales_value'],
  purchases: ['purchases', 'sales', 'conversions'], leads: ['leads', 'lead'], newLeads: ['newLeads', 'new_leads'], calls: ['calls', 'phone_calls'],
  refunds: ['refunds', 'refund_count'], refundAmount: ['refundAmount', 'refund_amount', 'refund'],
  postEngagement: ['postEngagement', 'post_engagement'], pageEngagement: ['pageEngagement', 'page_engagement'], reactions: ['reactions', 'post_reactions'], comments: ['comments'], shares: ['shares', 'post_shares'], saves: ['saves', 'post_saves'], pageLikes: ['pageLikes', 'page_likes'],
  videoPlays: ['videoPlays', 'video_plays'], videoViews3s: ['videoViews3s', 'video_views_3s', 'video_views'], thruplays: ['thruplays', 'thruplay'], videoP25: ['videoP25', 'video_p25'], videoP50: ['videoP50', 'video_p50'], videoP75: ['videoP75', 'video_p75'], videoP100: ['videoP100', 'video_p100'],
  messaging: ['messaging', 'conversations', 'messaging_conversations_started'], socialSpend: ['socialSpend', 'social_spend']
};
var MAX_ADS = 150;
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
    var row = Object.assign({ date: date }, cleanMetrics(d));
    if (d.conv && typeof d.conv === 'object') {
      var conv = {}; Object.keys(d.conv).slice(0, 40).forEach(function (k) { if (/^[a-z0-9_]{1,40}$/.test(k)) { var v = num(d.conv[k]); if (v) conv[k] = v; } });
      if (Object.keys(conv).length) row.conv = conv;
    }
    if (d.actions && typeof d.actions === 'object') {
      var acts = {}; Object.keys(d.actions).slice(0, 80).forEach(function (k) { if (/^[a-z0-9_.]{1,60}$/i.test(k)) { var v = num(d.actions[k]); if (v) acts[k] = v; } });
      if (Object.keys(acts).length) row.actions = acts;
    }
    byDate[date] = row;
  });
  return Object.keys(byDate).sort().slice(-DAYS).map(function (k) { return byDate[k]; });
}
function sumDaily(daily) {
  var out = {}; daily.forEach(function (d) { METRICS.forEach(function (k) { if (has(d[k])) out[k] = (out[k] || 0) + d[k]; }); });
  return out;
}
function cleanAd(ad) {
  if (!ad || typeof ad !== 'object') return null;
  var id = str(ad.id || ad.adId || ad.ad_id, 64).trim();
  if (!/^[0-9]{5,30}$/.test(id)) return null;
  var daily = cleanDaily(ad.daily || ad.days || ad.series);
  var metrics = cleanMetrics(ad.metrics || ad.totals || (daily.length ? {} : ad));
  if (!Object.keys(metrics).length && daily.length) metrics = sumDaily(daily);
  return {
    id: id,
    name: str(ad.name || ad.ad_name, 200).trim() || 'Ad ' + id,
    adSetId: str(ad.adSetId || ad.adset_id, 64).trim(),
    adSetName: str(ad.adSetName || ad.adset_name, 200).trim(),
    status: str(ad.status || ad.effective_status, 40).trim(),
    thumbnailUrl: /^https?:\/\//.test(String(ad.thumbnailUrl || ad.thumbnail_url || '')) ? str(ad.thumbnailUrl || ad.thumbnail_url, 1000) : '',
    imageUrl: /^https?:\/\//.test(String(ad.imageUrl || ad.image_url || '')) ? str(ad.imageUrl || ad.image_url, 1000) : '',
    videoId: /^[0-9]{5,30}$/.test(String(ad.videoId || ad.video_id || '')) ? String(ad.videoId || ad.video_id) : '',
    linkUrl: /^https?:\/\//.test(String(ad.linkUrl || ad.link_url || ad.link || '')) ? str(ad.linkUrl || ad.link_url || ad.link, 1000) : '',
    previewUrl: /^https?:\/\//.test(String(ad.previewUrl || ad.preview_url || ad.permalink || '')) ? str(ad.previewUrl || ad.preview_url || ad.permalink, 1000) : '',
    resultType: str(ad.resultType || ad.result_type, 80).trim(),
    metrics: metrics,
    daily: daily
  };
}
function cleanStatsItem(item) {
  if (!item || typeof item !== 'object') return null;
  var id = str(item.campaignId || item.campaign_id || item.id, 64).trim();
  if (!/^[0-9]{5,30}$/.test(id)) return null;
  var daily = cleanDaily(item.daily || item.days || item.series);
  var metrics = cleanMetrics(item.metrics || item.totals || item);
  if (!Object.keys(metrics).length && daily.length) metrics = sumDaily(daily);
  var ads = (Array.isArray(item.ads) ? item.ads : []).map(cleanAd).filter(Boolean).slice(0, MAX_ADS);
  return {
    id: id,
    name: str(item.name || item.campaign_name, 200).trim(),
    status: str(item.status || item.effective_status, 40).trim(),
    objective: str(item.objective, 80).trim(),
    resultType: str(item.resultType || item.result_type, 80).trim(),
    resultKey: str(item.resultKey || item.result_key, 40).trim().toLowerCase().replace(/[^a-z0-9_]/g, ''),
    convLabels: (function () { var o = {}; var src = item.convLabels && typeof item.convLabels === 'object' ? item.convLabels : {}; Object.keys(src).slice(0, 40).forEach(function (k) { if (/^[a-z0-9_]{1,40}$/.test(k)) o[k] = str(src[k], 120); }); return o; })(),
    optimisation: (Array.isArray(item.optimisation) ? item.optimisation : []).slice(0, 50).map(function (o) { return { id: str(o && o.id, 40), name: str(o && o.name, 200), goal: str(o && o.goal, 60), event: str(o && o.event, 60), customConversionId: str(o && o.customConversionId, 40) }; }),
    currency: str(item.currency, 10).trim(),
    period: item.period && typeof item.period === 'object' ? { since: str(item.period.since, 10), until: str(item.period.until, 10) } : null,
    metrics: metrics,
    daily: daily,
    ads: ads,
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

// ---- Dashboard layout: which metrics the tiles and cards show (shared by everyone, max 15) ----
var MAX_METRICS = 15;
var DEFAULT_METRICS = ['spend', 'results', 'costPerResult', 'impressions', 'reach', 'cpm', 'cplc', 'ctrAll', 'linkCtr', 'frequency'];
function readDashboard() {
  return docs.get('settings', 'dashboard').then(function (row) {
    var list = row && Array.isArray(row.metrics) ? row.metrics.filter(function (k) { return /^[a-zA-Z_.]{1,40}$/.test(k); }).slice(0, MAX_METRICS) : DEFAULT_METRICS;
    return { metrics: list.length ? list : DEFAULT_METRICS, max: MAX_METRICS, updatedAt: row ? row.updatedAt || null : null };
  });
}
function writeDashboard(body) {
  var list = body && Array.isArray(body.metrics) ? body.metrics.map(function (k) { return String(k || '').trim(); }).filter(function (k) { return /^[a-zA-Z_.]{1,40}$/.test(k); }) : null;
  if (!list || !list.length) return Promise.reject(Object.assign(new Error('Send { metrics: ["spend", …] } with 1 to ' + MAX_METRICS + ' metric keys.'), { code: 'BAD_INPUT' }));
  var seen = {}; list = list.filter(function (k) { if (seen[k]) return false; seen[k] = true; return true; });
  if (list.length > MAX_METRICS) return Promise.reject(Object.assign(new Error('At most ' + MAX_METRICS + ' metrics at a time.'), { code: 'BAD_INPUT' }));
  return docs.put('settings', 'dashboard', { metrics: list }).then(readDashboard);
}

// ---- Bookings logged by hand per client (Ad Accounts row), tied to a Meta ad account ----
// Stored as docs "bookings"/<ad accounts row id>: { metaAccountId, label, entries: [{ date, count }] }.
var MAX_BOOKING_ROWS = 2000;
function cleanBookings(body, existing) {
  body = body && typeof body === 'object' ? body : {};
  var out = Object.assign({ metaAccountId: '', label: 'Bookings', entries: [] }, existing || {});
  if (body.metaAccountId !== undefined) { var acct = str(body.metaAccountId, 40).trim(); if (acct && !/^act_/.test(acct)) acct = 'act_' + acct; if (acct && !/^act_[0-9]{3,30}$/.test(acct)) throw Object.assign(new Error('metaAccountId must look like act_123456.'), { code: 'BAD_INPUT' }); out.metaAccountId = acct; }
  if (body.label !== undefined) out.label = str(body.label, 40).trim() || 'Bookings';
  if (body.entries !== undefined) {
    if (!Array.isArray(body.entries)) throw Object.assign(new Error('entries must be a list of { date: "YYYY-MM-DD", count }.'), { code: 'BAD_INPUT' });
    var byDate = {};
    body.entries.slice(0, MAX_BOOKING_ROWS).forEach(function (e) {
      var date = str(e && (e.date || e.day), 10).trim(); var n = Math.round(num(e && e.count));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) throw Object.assign(new Error('Each entry needs a date like 2026-08-04.'), { code: 'BAD_INPUT' });
      if (n < 0 || n > 100000) throw Object.assign(new Error('Counts must be between 0 and 100000.'), { code: 'BAD_INPUT' });
      byDate[date] = (byDate[date] || 0) + n;
    });
    out.entries = Object.keys(byDate).sort().filter(function (d) { return byDate[d] > 0; }).map(function (d) { return { date: d, count: byDate[d] }; });
  }
  return out;
}
function listBookings() {
  var accounts = require('./store');
  return Promise.all([docs.list('bookings'), accounts.list()]).then(function (r) {
    var rows = {}; r[0].forEach(function (b) { rows[b.id] = b; });
    return (r[1] || []).map(function (a) {
      var b = rows[a.id] || {};
      var m = /[?&]act=(\d+)/.exec(String(a.link || '')) || /act_(\d+)/.exec(String(a.link || ''));
      var entries = Array.isArray(b.entries) ? b.entries : [];
      return { accountId: a.id, client: a.client || '', company: a.company || '', metaAccountId: b.metaAccountId || (m ? 'act_' + m[1] : ''), linkedFromLink: !b.metaAccountId && !!m, label: b.label || 'Bookings', entries: entries, total: entries.reduce(function (n, e) { return n + (e.count || 0); }, 0), updatedAt: b.updatedAt || null };
    });
  });
}
function writeBookings(accountId, body) {
  var accounts = require('./store');
  return accounts.get(accountId).then(function (a) {
    if (!a) return null;
    return docs.get('bookings', accountId).then(function (existing) {
      var next = cleanBookings(body, existing); next.updatedAt = Date.now();
      return docs.put('bookings', accountId, next).then(function () { return listBookings(); }).then(function (list) { return list.filter(function (b) { return b.accountId === accountId; })[0] || null; });
    });
  });
}
function removeBookings(accountId) { return docs.remove('bookings', accountId); }

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
  return Promise.all([listTracked(), docs.list('stats'), docs.get('settings', 'stats'), docs.get('meta', 'campaigns'), hermes.config(), knownAccounts(), docs.get('settings', 'apikey'), meta.config(), readDashboard(), listBookings()]).then(function (r) {
    var stats = {}; r[1].forEach(function (s) { stats[s.id] = s; });
    var settings = r[2] || {};
    var key = r[6] || {};
    var mc = r[7];
    return {
      dashboard: r[8],
      bookings: r[9],
      meta: { set: mc.set, masked: mc.masked, source: mc.source, user: mc.user, accounts: mc.accounts, checkedAt: mc.checkedAt, error: mc.error },
      source: mc.set ? 'meta' : 'hermes',
      hermesKeySet: !!key.hash,
      hermesLastSeenAt: key.lastSeenAt || null,
      lastCatalogRequest: settings.lastCatalogRequest || null,
      tracked: r[0].map(function (t) { var s = stats[t.id]; return Object.assign({}, t, { stats: s ? { metrics: s.metrics, daily: s.daily, ads: s.ads || [], resultType: s.resultType || '', resultKey: s.resultKey || '', convLabels: s.convLabels || {}, optimisation: s.optimisation || [], objective: s.objective || '', currency: s.currency, period: s.period, syncedAt: s.syncedAt } : null }); }),
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
  p.push('Pull Meta Ads performance for the campaigns listed below and ONLY those campaigns. Do not query any other campaign; keep Meta API calls to a minimum (per campaign: one insights call at campaign level and one at ad level, each with a daily breakdown).');
  p.push('');
  p.push('CAMPAIGNS:');
  tracked.forEach(function (t, i) { p.push((i + 1) + '. ' + t.name + ' — campaign ID ' + t.id + (t.adAccountId ? ' (ad account ' + t.adAccountId + ')' : '')); });
  p.push('');
  p.push('PERIOD: ' + today(-(DAYS - 1)) + ' to ' + today(0) + ', time_increment=1 (one row per day).');
  p.push('FIELDS PER DAY (campaign level AND ad level): spend, impressions, reach, clicks (all clicks), inline_link_clicks (link clicks), results and the result type Meta reports for the campaign objective (for example "Leads", "Purchases", "Link clicks"), plus leads, purchases and purchase value (revenue) when the campaign tracks them.');
  p.push('For each ad also send: ad id, ad name, ad set name, effective status (delivery), and the ad creative thumbnail URL if available.');
  p.push('');
  p.push('Then send everything to AdBuilder with the ADBUILDER_API_KEY (header "Authorization: Bearer <key>"):');
  p.push('PUT ' + reportUrl);
  p.push('{ "items": [ {');
  p.push('    "campaignId": "<id>", "name": "<name>", "status": "<ACTIVE|PAUSED|...>", "objective": "<objective>", "resultType": "<Leads|Purchases|...>", "currency": "<AUD>",');
  p.push('    "daily": [ { "date": "YYYY-MM-DD", "spend": 0, "impressions": 0, "reach": 0, "clicksAll": 0, "linkClicks": 0, "results": 0, "leads": 0, "purchases": 0, "revenue": 0 } ],');
  p.push('    "ads": [ { "id": "<ad id>", "name": "<ad name>", "adSetName": "<ad set>", "status": "<ACTIVE|PAUSED|...>", "thumbnailUrl": "<https://...>",');
  p.push('               "daily": [ { "date": "YYYY-MM-DD", "spend": 0, "impressions": 0, "reach": 0, "clicksAll": 0, "linkClicks": 0, "results": 0 } ] } ]');
  p.push('} ] }');
  p.push('Send every campaign in one request (split into several requests only if the body would exceed 4 MB). Reply with which campaigns were updated and any that could not be read.');
  return p.join('\n');
}
// Direct: the app pulls the insights itself, one campaign after another, and stores them at once.
function directRefresh(source, tracked, settings, token) {
  var since = today(-(DAYS - 1)), until = today(0);
  var items = [], errors = [];
  return tracked.reduce(function (chain, t) {
    return chain.then(function () {
      return meta.campaignStats(token, t, since, until).then(function (item) { items.push(item); }, function (err) { errors.push({ id: t.id, name: t.name, error: err.message, code: err.code }); });
    });
  }, Promise.resolve()).then(function () {
    if (!items.length) { var e = new Error(errors[0] ? errors[0].error : 'Meta returned nothing.'); e.code = errors[0] && errors[0].code === 'META_AUTH' ? 'META_AUTH' : 'META_ERROR'; throw e; }
    return storeStats({ items: items });
  }).then(function (stored) {
    return docs.get('settings', 'stats').then(function (fresh) {
      fresh = fresh || {};
      var record = { at: Date.now(), source: source, direct: true, campaigns: tracked.length, stored: stored.stored.length, errors: errors, status: 200, ok: true };
      fresh.lastRefresh = record; fresh.pending = null;
      return docs.put('settings', 'stats', fresh).then(function () { return record; });
    });
  });
}
function refresh(source, baseUrl) {
  return Promise.all([listTracked(), hermes.config(), docs.get('settings', 'stats'), meta.config()]).then(function (r) {
    var tracked = r[0], cfg = r[1], settings = r[2] || {}, mc = r[3];
    if (!tracked.length) { var e0 = new Error('No campaigns are being tracked yet. Choose campaigns first.'); e0.code = 'NOTHING_TRACKED'; throw e0; }
    var last = settings.lastRefresh && settings.lastRefresh.at || 0;
    if (source === 'manual' && Date.now() - last < (mc.set ? 15000 : REFRESH_COOLDOWN_MS)) {
      var e1 = new Error('A refresh ran ' + Math.round((Date.now() - last) / 1000) + ' s ago. Wait a moment before pulling again.'); e1.code = 'COOLDOWN'; throw e1;
    }
    if (mc.set) return directRefresh(source, tracked, settings, mc.token);
    var base = cfg.publicBaseUrl || baseUrl || '';
    var reportUrl = base + '/api/v1/campaign-stats';
    var body = {
      event: 'adbuilder.stats.refresh', event_type: 'adbuilder.stats.refresh', source: 'adbuilder', trigger: source, sentAt: new Date().toISOString(), campaignId: 'stats-refresh',
      prompt: refreshPrompt(tracked, reportUrl),
      campaigns: tracked.map(function (t) { return { id: t.id, name: t.name, adAccountId: t.adAccountId }; }),
      period: { since: today(-(DAYS - 1)), until: today(0) },
      reportUrl: reportUrl
    };
    return hermes.send(cfg, body, 'adbuilder.stats.refresh').then(function (reply) {
      var record = { at: Date.now(), source: source, campaigns: tracked.length, status: reply.status, ok: reply.ok, reply: reply.body, deliveryId: reply.deliveryId, error: reply.ignored || (reply.ok ? undefined : 'Hermes ' + hermes.statusText(reply)) };
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
function directSync(accountIds, known, settings, token) {
  var api = require('./api');   // lazy: api.js requires this file
  var wanted = Array.isArray(accountIds) && accountIds.length ? known.filter(function (a) { return accountIds.indexOf(a.id) !== -1; }) : [];
  var work = wanted.length
    ? meta.campaigns(token, wanted).then(function (list) { return api.storeMeta({ campaigns: list }).then(function () { return { kind: 'campaigns', count: list.length, accounts: wanted.map(function (a) { return a.id; }) }; }); })
    : meta.adAccounts(token).then(function (list) { return api.storeMeta({ adAccounts: list }).then(function () { return { kind: 'accounts', count: list.length, accounts: [] }; }); });
  return work.then(function (res) {
    var record = Object.assign({ at: Date.now(), direct: true, status: 200, ok: true }, res);
    settings.lastCatalogRequest = record; settings.pendingCatalog = null;
    return docs.put('settings', 'stats', settings).then(function () { return record; });
  });
}
function syncCatalog(accountIds, baseUrl) {
  return Promise.all([knownAccounts(), hermes.config(), docs.get('settings', 'stats'), meta.config()]).then(function (r) {
    var known = r[0], cfg = r[1], settings = r[2] || {}, mc = r[3];
    if (mc.set) return directSync(accountIds, known, settings, mc.token);
    var last = settings.lastCatalogRequest && settings.lastCatalogRequest.at || 0;
    if (Date.now() - last < SYNC_COOLDOWN_MS) { var e1 = new Error('Hermes was asked ' + Math.round((Date.now() - last) / 1000) + ' s ago. Give it a moment.'); e1.code = 'COOLDOWN'; throw e1; }
    var wanted = Array.isArray(accountIds) && accountIds.length ? known.filter(function (a) { return accountIds.indexOf(a.id) !== -1; }) : known;
    var kind = wanted.length ? 'campaigns' : 'accounts';
    var base = cfg.publicBaseUrl || baseUrl || '';
    var metaUrl = base + '/api/v1/meta';
    var event = kind === 'accounts' ? 'adbuilder.accounts.sync' : 'adbuilder.campaigns.sync';
    var body = {
      event: event, event_type: event, source: 'adbuilder', sentAt: new Date().toISOString(), campaignId: kind + '-sync',
      prompt: syncPrompt(kind, wanted, metaUrl),
      accounts: wanted.map(function (a) { return { id: a.id, name: a.name }; }),
      reportUrl: metaUrl
    };
    return hermes.send(cfg, body, event).then(function (reply) {
      var record = { at: Date.now(), kind: kind, accounts: wanted.map(function (a) { return a.id; }), status: reply.status, ok: reply.ok, reply: reply.body, deliveryId: reply.deliveryId, error: reply.ignored || (reply.ok ? undefined : 'Hermes ' + hermes.statusText(reply)) };
      settings.pendingCatalog = reply.ok ? record : null;
      settings.lastCatalogRequest = record;
      return docs.put('settings', 'stats', settings).then(function () { return record; });
    });
  });
}
function catalogArrived() {
  return docs.get('settings', 'stats').then(function (s) { if (s && s.pendingCatalog) { s.pendingCatalog = null; return docs.put('settings', 'stats', s); } });
}

module.exports = { listBookings: listBookings, writeBookings: writeBookings, removeBookings: removeBookings, readDashboard: readDashboard, writeDashboard: writeDashboard, setResultOverride: setResultOverride, syncCatalog: syncCatalog, catalogArrived: catalogArrived, knownAccounts: knownAccounts, listTracked: listTracked, setTracked: setTracked, storeStats: storeStats, overview: overview, refresh: refresh, schedule: schedule, refreshPrompt: refreshPrompt, cleanStatsItem: cleanStatsItem, DAYS: DAYS };
