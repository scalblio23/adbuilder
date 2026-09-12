// Request handlers for campaigns, creatives, settings, and the Hermes integration.
// Used by both server.js and the Vercel functions under api/.
var docs = require('./docs');
var accounts = require('./store');
var hermes = require('./hermes');
var ai = require('./ai');

var crypto = require('crypto');
var MAX_CREATIVE_BYTES = 3.5 * 1024 * 1024;   // Vercel accepts request bodies up to 4.5 MB

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
function fail(res, err) {
  console.error(err);
  send(res, 500, { error: 'Storage error: ' + (err && err.message ? err.message : 'unknown') });
}
function notAllowed(res, allow) { res.setHeader('Allow', allow); send(res, 405, { error: 'Method not allowed' }); }
function validId(id) { return /^[A-Za-z0-9_-]{1,64}$/.test(id || ''); }
function str(v, max) { return String(v == null ? '' : v).slice(0, max || 500); }

// ---- Campaigns: the Ad Builder's saved drafts. Whole draft lives in `data`. ----
function campaignMeta(body, existing) {
  var data = body && typeof body.data === 'object' && body.data ? body.data : (existing ? existing.data : {});
  var json = JSON.stringify(data);
  if (json.length > 400000) return null;
  return {
    name: str(body && body.name != null ? body.name : (existing ? existing.name : 'Untitled campaign'), 200) || 'Untitled campaign',
    status: ['draft', 'ready', 'launched'].indexOf(body && body.status) !== -1 ? body.status : (existing ? existing.status : 'draft'),
    data: JSON.parse(json)
  };
}
function campaigns(req, res, body) {
  if (req.method === 'GET') {
    return docs.list('campaigns').then(function (rows) {
      send(res, 200, rows.map(function (r) { return { id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt }; }));
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'POST') {
    var meta = campaignMeta(body || {}, null);
    if (!meta) return send(res, 400, { error: 'Campaign is too large.' });
    return docs.put('campaigns', docs.newId(), meta).then(function (row) { send(res, 201, row); }, function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, POST');
}
function campaign(req, res, id, body) {
  if (!validId(id)) return send(res, 404, { error: 'Campaign not found.' });
  if (req.method === 'GET') {
    return docs.get('campaigns', id).then(function (row) { row ? send(res, 200, row) : send(res, 404, { error: 'Campaign not found.' }); }, function (e) { fail(res, e); });
  }
  if (req.method === 'PUT') {
    return docs.get('campaigns', id).then(function (existing) {
      if (!existing) return send(res, 404, { error: 'Campaign not found.' });
      var meta = campaignMeta(body || {}, existing);
      if (!meta) return send(res, 400, { error: 'Campaign is too large.' });
      return docs.put('campaigns', id, meta).then(function (row) { send(res, 200, row); });
    }).catch(function (e) { fail(res, e); });
  }
  if (req.method === 'DELETE') {
    return docs.remove('campaigns', id).then(function (ok) { ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Campaign not found.' }); }, function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, PUT, DELETE');
}

// ---- Creatives: uploaded images/videos (base64 in the blob) or linked by URL. ----
// Stores one creative (base64 bytes or a URL). Resolves { row, duplicate } or rejects with {status, message}.
function storeCreative(input) {
  input = input || {};
  var err = function (status, message) { var e = new Error(message); e.status = status; return e; };
  var name = str(input.name, 200).trim();
  if (!name) return Promise.reject(err(400, 'Creative name is required.'));
  var meta = { name: name, mime: str(input.mime, 100), url: str(input.url, 2000).trim(), size: 0, source: str(input.source, 40) || 'upload' };
  var blob;
  if (input.data) {
    if (typeof input.data !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(input.data)) return Promise.reject(err(400, 'Upload must be base64.'));
    blob = input.data.replace(/[\r\n]/g, '');
    meta.size = Math.floor(blob.length * 3 / 4);
    if (meta.size > MAX_CREATIVE_BYTES) return Promise.reject(err(413, 'File is too large. Keep uploads under 3.5 MB or link to the file instead.'));
    if (!/^(image|video)\//.test(meta.mime)) return Promise.reject(err(400, 'Only image and video files can be uploaded.'));
    meta.hash = crypto.createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex');
  } else if (!meta.url) {
    return Promise.reject(err(400, 'Upload a file or provide a URL.'));
  } else {
    if (!/^https?:\/\//i.test(meta.url)) meta.url = 'https://' + meta.url;
    meta.hash = crypto.createHash('sha256').update(meta.url).digest('hex');
  }
  return docs.list('creatives').then(function (rows) {
    var existing = rows.filter(function (r) { return r.hash === meta.hash; })[0];
    if (existing) return { row: existing, duplicate: true };
    return docs.put('creatives', docs.newId(), meta, blob).then(function (row) { return { row: row, duplicate: false }; });
  });
}
function creatives(req, res, body) {
  if (req.method === 'GET') {
    return docs.list('creatives').then(function (rows) { send(res, 200, rows); }, function (e) { fail(res, e); });
  }
  if (req.method === 'POST') {
    return storeCreative(body).then(function (r) { send(res, r.duplicate ? 200 : 201, withUrl(req, r.row, r.duplicate)); },
      function (e) { e.status ? send(res, e.status, { error: e.message }) : fail(res, e); });
  }
  notAllowed(res, 'GET, POST');
}
function withUrl(req, row, duplicate) {
  var out = Object.assign({}, row);
  out.url = row.size ? baseUrl(req) + '/api/creatives/' + row.id : row.url;
  out.permanentUrl = out.url;
  if (duplicate) out.duplicate = true;
  return out;
}
function creative(req, res, id, body) {
  if (!validId(id)) return send(res, 404, { error: 'Creative not found.' });
  if (req.method === 'GET') {
    return docs.get('creatives', id, true).then(function (row) {
      if (!row) return send(res, 404, { error: 'Creative not found.' });
      if (!row.blob) { res.statusCode = 302; res.setHeader('Location', row.url); return res.end(); }
      var bytes = Buffer.from(row.blob, 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', row.mime || 'application/octet-stream');
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(bytes);
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'DELETE') {
    return docs.remove('creatives', id).then(function (ok) { ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Creative not found.' }); }, function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, DELETE');
}

// ---- Settings: Hermes connection. The key is stored server-side and never sent back in full. ----
function maskKey(key) { return key ? '••••' + key.slice(-4) : ''; }
function publicSettings(cfg) {
  return { hermesUrl: cfg.url, hermesKeyMasked: maskKey(cfg.key), hermesConfigured: !!(cfg.url && cfg.key), source: cfg.source,
    auth: cfg.auth, launchPath: cfg.launchPath, testPath: cfg.testPath, testMethod: cfg.testMethod, publicBaseUrl: cfg.publicBaseUrl };
}
function settings(req, res, body) {
  if (req.method === 'GET') return hermes.config().then(function (cfg) { send(res, 200, publicSettings(cfg)); }, function (e) { fail(res, e); });
  if (req.method === 'PUT') {
    body = body || {};
    return docs.get('settings', 'hermes').then(function (existing) {
      var cur = Object.assign({}, hermes.DEFAULTS, existing || {});
      var meta = {
        url: str(body.hermesUrl != null ? body.hermesUrl : cur.url, 500).trim().replace(/\/+$/, ''),
        key: body.hermesKey ? str(body.hermesKey, 500).trim() : (body.clearKey ? '' : cur.key),
        auth: ['bearer', 'x-api-key', 'both'].indexOf(body.auth) !== -1 ? body.auth : cur.auth,
        launchPath: normPath(body.launchPath != null ? body.launchPath : cur.launchPath),
        testPath: normPath(body.testPath != null ? body.testPath : cur.testPath),
        testMethod: ['GET', 'POST'].indexOf(String(body.testMethod || cur.testMethod).toUpperCase()) !== -1 ? String(body.testMethod || cur.testMethod).toUpperCase() : 'GET',
        publicBaseUrl: str(body.publicBaseUrl != null ? body.publicBaseUrl : cur.publicBaseUrl, 500).trim().replace(/\/+$/, '')
      };
      return docs.put('settings', 'hermes', meta).then(function () { return hermes.config(); }).then(function (cfg) { send(res, 200, publicSettings(cfg)); });
    }).catch(function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, PUT');
}
function normPath(p) { p = str(p, 200).trim(); if (!p) return ''; return p.charAt(0) === '/' ? p : '/' + p; }

// Where this app is reachable from the outside, for asset links Hermes can fetch.
function baseUrl(req) {
  var proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'https';
  var host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (/^localhost|^127\./.test(host)) proto = 'http';
  return host ? proto + '://' + host : '';
}

// ---- Meta catalog: ad accounts, pixels/datasets, and pages that Hermes syncs from the Meta token ----
var META_KINDS = { adAccounts: 'act', pixels: 'pixel', pages: 'page' };
function normalizeMetaItem(kind, item) {
  if (!item || typeof item !== 'object') return null;
  var id = String(item.id || item.account_id || item.pixel_id || item.dataset_id || item.page_id || '').trim();
  var name = String(item.name || item.title || item.account_name || '').trim();
  if (!id) return null;
  if (kind === 'adAccounts' && !/^act_/.test(id)) id = 'act_' + id;
  var out = { id: id, name: name || id };
  if (kind === 'adAccounts') { if (item.currency) out.currency = str(item.currency, 10); if (item.account_status != null || item.status != null) out.status = str(item.account_status != null ? item.account_status : item.status, 40); }
  if (kind === 'pixels' && (item.ad_account_id || item.adAccountId || item.owner_ad_account)) out.adAccountId = str(item.ad_account_id || item.adAccountId || (item.owner_ad_account && item.owner_ad_account.id), 40);
  if (kind === 'pages' && item.category) out.category = str(item.category, 100);
  return out;
}
function storeMeta(body) {
  body = body || {};
  var counts = {};
  return Object.keys(META_KINDS).reduce(function (chain, kind) {
    var list = body[kind] || body[kind.toLowerCase()] || (kind === 'adAccounts' ? body.ad_accounts || body.accounts : kind === 'pixels' ? body.datasets : null);
    if (!Array.isArray(list)) return chain;
    var items = list.map(function (i) { return normalizeMetaItem(kind, i); }).filter(Boolean).slice(0, 2000);
    counts[kind] = items.length;
    return chain.then(function () { return docs.put('meta', kind, { items: items, syncedAt: Date.now() }); });
  }, Promise.resolve()).then(function () { return counts; });
}
function readMeta() {
  return Promise.all(Object.keys(META_KINDS).map(function (kind) { return docs.get('meta', kind); })).then(function (rows) {
    var out = {};
    Object.keys(META_KINDS).forEach(function (kind, i) { out[kind] = { items: (rows[i] && rows[i].items) || [], syncedAt: rows[i] ? rows[i].syncedAt || null : null }; });
    return out;
  });
}
// GET /api/meta -> the synced catalog (used by the Ad Builder dropdowns)
function meta(req, res) {
  if (req.method !== 'GET') return notAllowed(res, 'GET');
  readMeta().then(function (m) { send(res, 200, m); }, function (e) { fail(res, e); });
}
// POST /api/hermes/meta -> optional: this app pulls the catalog from Hermes (Advanced connection)
function hermesMeta(req, res) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  hermes.pullMeta().then(storeMeta).then(function (counts) { send(res, 200, { ok: true, counts: counts }); }).catch(function (e) {
    if (e && e.code === 'NOT_CONFIGURED') return send(res, 501, { error: 'Hermes pushes this data in with its access token (PUT /api/v1/meta). To pull instead, set up the Advanced connection.' });
    if (e && e.code === 'UNREACHABLE') return send(res, 502, { error: e.message });
    fail(res, e);
  });
}

// ---- Swipe file: Meta Ad Library creatives that Hermes collects ----
var SWIPE_FIELDS = ['libraryId', 'advertiser', 'advertiserPageId', 'mediaType', 'mediaUrl', 'mediaCreativeId', 'thumbnailUrl', 'thumbnailCreativeId',
  'copy', 'headline', 'cta', 'landingUrl', 'ranking', 'mediaHash', 'startedAt', 'firstSeenAt', 'lastSeenAt', 'active', 'notes', 'tags'];
function cleanSwipe(input, existing) {
  if (!input || typeof input !== 'object') return null;
  var cur = existing || {};
  var libraryId = str(input.libraryId || input.library_id || input.id || cur.libraryId, 64).trim().replace(/\D/g, '');
  if (!libraryId) return null;
  var mediaType = String(input.mediaType || input.media_type || cur.mediaType || '').toLowerCase();
  if (['image', 'video', 'carousel'].indexOf(mediaType) === -1) mediaType = /video/.test(String(input.mediaUrl || input.media_url || '')) ? 'video' : 'image';
  var num = function (v, fallback) { var n = Number(v); return isFinite(n) ? n : fallback; };
  var when = function (v, fallback) { if (v == null || v === '') return fallback; var n = typeof v === 'number' ? v : Date.parse(v); return isFinite(n) ? n : fallback; };
  var now = Date.now();
  return {
    libraryId: libraryId,
    advertiser: str(input.advertiser || input.page_name || input.pageName, 200).trim() || cur.advertiser || '',
    advertiserPageId: str(input.advertiserPageId || input.page_id || input.pageId, 64).trim() || cur.advertiserPageId || '',
    mediaType: mediaType,
    mediaUrl: str(input.mediaUrl || input.media_url, 2000).trim() || cur.mediaUrl || '',
    mediaCreativeId: str(input.mediaCreativeId || input.media_creative_id, 64).trim() || cur.mediaCreativeId || '',
    thumbnailUrl: str(input.thumbnailUrl || input.thumbnail_url || input.thumbnail, 2000).trim() || cur.thumbnailUrl || '',
    thumbnailCreativeId: str(input.thumbnailCreativeId || input.thumbnail_creative_id, 64).trim() || cur.thumbnailCreativeId || '',
    copy: str(input.copy || input.body || input.primary_text, 10000).trim() || cur.copy || '',
    headline: str(input.headline || input.title, 500).trim() || cur.headline || '',
    cta: str(input.cta || input.cta_text || input.callToAction, 100).trim() || cur.cta || '',
    landingUrl: str(input.landingUrl || input.landing_url || input.link_url, 2000).trim() || cur.landingUrl || '',
    ranking: Math.max(0, Math.min(5, num(input.ranking != null ? input.ranking : cur.ranking, 0))),
    mediaHash: str(input.mediaHash || input.media_hash, 128).trim().toLowerCase() || cur.mediaHash || '',
    startedAt: when(input.startedAt || input.started_at || input.start_date, cur.startedAt || null),
    firstSeenAt: cur.firstSeenAt || when(input.firstSeenAt || input.first_seen_at, now),
    lastSeenAt: when(input.lastSeenAt || input.last_seen_at, now),
    active: input.active != null ? !!input.active : (input.is_active != null ? !!input.is_active : (cur.active != null ? cur.active : true)),
    notes: str(input.notes, 5000).trim() || cur.notes || '',
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20).map(function (t) { return str(t, 40).trim(); }).filter(Boolean) : (cur.tags || [])
  };
}
// Upsert one or many. Deduplicates by Library ID (document id) and by media hash.
function upsertSwipes(list) {
  return docs.list('swipes').then(function (rows) {
    var byId = {}, byHash = {};
    rows.forEach(function (r) { byId[r.id] = r; if (r.mediaHash) byHash[r.mediaHash] = r; });
    var result = { upserted: [], duplicates: [], rejected: 0 };
    return list.reduce(function (chain, input) {
      return chain.then(function () {
        var probe = cleanSwipe(input, null);
        if (!probe) { result.rejected++; return; }
        var existing = byId[probe.libraryId];
        var meta = cleanSwipe(input, existing);
        if (existing && existing.aliasLibraryIds) meta.aliasLibraryIds = existing.aliasLibraryIds;
        if (!existing && meta.mediaHash && byHash[meta.mediaHash]) {
          // Same media under a different Library ID: keep one record, remember the alias.
          var dup = byHash[meta.mediaHash];
          var aliases = (dup.aliasLibraryIds || []).concat([meta.libraryId]).filter(function (v, i, a) { return a.indexOf(v) === i; });
          var merged = Object.assign({}, dup, { aliasLibraryIds: aliases, lastSeenAt: Math.max(dup.lastSeenAt || 0, meta.lastSeenAt || 0), active: meta.active });
          delete merged.id; delete merged.createdAt; delete merged.updatedAt;
          return docs.put('swipes', dup.id, merged).then(function (row) { byId[row.id] = row; result.duplicates.push({ libraryId: meta.libraryId, keptLibraryId: row.id, reason: 'same media hash' }); });
        }
        return docs.put('swipes', meta.libraryId, meta).then(function (row) {
          byId[row.id] = row; if (row.mediaHash) byHash[row.mediaHash] = row;
          result.upserted.push({ libraryId: row.id, created: !existing });
        });
      });
    }, Promise.resolve()).then(function () { return result; });
  });
}
function swipes(req, res, body) {
  if (req.method === 'GET') {
    return docs.list('swipes').then(function (rows) {
      rows.sort(function (a, b) { return (b.ranking - a.ranking) || ((b.lastSeenAt || 0) - (a.lastSeenAt || 0)); });
      send(res, 200, rows);
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    var list = Array.isArray(body) ? body : (body && Array.isArray(body.items)) ? body.items : (body && (body.libraryId || body.library_id || body.id)) ? [body] : null;
    if (!list || !list.length) return send(res, 400, { error: 'Send one record or { items: [...] }. Each needs at least a libraryId.' });
    if (list.length > 500) return send(res, 413, { error: 'Send at most 500 records per request.' });
    return upsertSwipes(list).then(function (r) { send(res, 200, Object.assign({ ok: true }, r)); }, function (e) { fail(res, e); });
  }
  if (req.method === 'DELETE') {
    body = body || {};
    return docs.list('swipes').then(function (rows) {
      var ids = body.all ? rows.map(function (r) { return r.id; }) : (Array.isArray(body.ids) ? body.ids.filter(validId) : []);
      if (!ids.length) return send(res, 400, { error: 'Send { ids: [...] } or { all: true }.' });
      var removed = 0;
      return ids.reduce(function (chain, id) { return chain.then(function () { return docs.remove('swipes', id).then(function (ok) { if (ok) removed++; }); }); }, Promise.resolve())
        .then(function () { send(res, 200, { ok: true, removed: removed }); });
    }).catch(function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, PUT, POST, DELETE');
}
function swipe(req, res, id, body) {
  if (!validId(id)) return send(res, 404, { error: 'Not found.' });
  if (req.method === 'GET') return docs.get('swipes', id).then(function (row) { row ? send(res, 200, row) : send(res, 404, { error: 'Not found.' }); }, function (e) { fail(res, e); });
  if (req.method === 'PUT') {
    return docs.get('swipes', id).then(function (existing) {
      if (!existing) return send(res, 404, { error: 'Not found.' });
      var meta = cleanSwipe(Object.assign({ libraryId: id }, body || {}), existing);
      if (existing.aliasLibraryIds) meta.aliasLibraryIds = existing.aliasLibraryIds;
      return docs.put('swipes', id, meta).then(function (row) { send(res, 200, row); });
    }).catch(function (e) { fail(res, e); });
  }
  if (req.method === 'DELETE') return docs.remove('swipes', id).then(function (ok) { ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found.' }); }, function (e) { fail(res, e); });
  notAllowed(res, 'GET, PUT, DELETE');
}

// ---- POST /api/creatives/import (key-protected): media + optional thumbnail + metadata in one call ----
// multipart/form-data: media=<file>, thumbnail=<file, optional>, metadata=<JSON string> (or plain fields libraryId, advertiser, …)
// application/json:    { media: {name, mime, data(base64)} | {url}, thumbnail: {...}, metadata: {...} }
var multipart = require('./multipart');
function importCreative(req, res, body) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  var type = String(req.headers['content-type'] || '');
  var parsed;
  if (/multipart\/form-data/i.test(type)) {
    parsed = multipart.readRaw(req, 6 * 1024 * 1024).then(function (raw) {
      var form = multipart.parse(raw, type);
      var metadata = {};
      if (form.fields.metadata) { try { metadata = JSON.parse(form.fields.metadata); } catch (e) { throw Object.assign(new Error('metadata must be valid JSON.'), { status: 400 }); } }
      Object.keys(form.fields).forEach(function (k) { if (k !== 'metadata' && metadata[k] == null) metadata[k] = form.fields[k]; });
      var toInput = function (f, fallbackName) { return f ? { name: f.filename || fallbackName, mime: f.mime, data: f.buffer.toString('base64'), source: 'meta_ad_library' } : null; };
      return { media: toInput(form.files.media || form.files.file, 'media'), thumbnail: toInput(form.files.thumbnail || form.files.thumb, 'thumbnail'), metadata: metadata };
    });
  } else {
    body = body || {};
    parsed = Promise.resolve({
      media: body.media ? Object.assign({ source: 'meta_ad_library' }, body.media) : null,
      thumbnail: body.thumbnail ? Object.assign({ source: 'meta_ad_library' }, body.thumbnail) : null,
      metadata: body.metadata || body
    });
  }
  return parsed.then(function (p) {
    var meta = p.metadata || {};
    var libraryId = String(meta.libraryId || meta.library_id || meta.id || '').replace(/\D/g, '');
    if (!libraryId) throw Object.assign(new Error('metadata.libraryId is required.'), { status: 400 });
    if (!p.media && !(meta.mediaUrl || meta.media_url)) throw Object.assign(new Error('Attach a media file (field "media") or give metadata.mediaUrl.'), { status: 400 });
    var mediaInput = p.media || { name: 'library-' + libraryId, url: meta.mediaUrl || meta.media_url, source: 'meta_ad_library' };
    if (!mediaInput.name) mediaInput.name = 'library-' + libraryId;
    return storeCreative(mediaInput).then(function (m) {
      var thumbP = p.thumbnail ? storeCreative(Object.assign({ name: 'library-' + libraryId + '-thumb' }, p.thumbnail)) : Promise.resolve(null);
      return thumbP.then(function (t) {
        var mediaRow = withUrl(req, m.row, m.duplicate);
        var record = Object.assign({}, meta, {
          libraryId: libraryId,
          mediaType: meta.mediaType || meta.media_type || (/^video/.test(mediaRow.mime || '') ? 'video' : 'image'),
          mediaUrl: mediaRow.url, mediaCreativeId: mediaRow.id, mediaHash: mediaRow.hash
        });
        if (t) { var thumbRow = withUrl(req, t.row, t.duplicate); record.thumbnailUrl = thumbRow.url; record.thumbnailCreativeId = thumbRow.id; }
        return upsertSwipes([record]).then(function (result) {
          var savedId = result.upserted[0] ? result.upserted[0].libraryId : (result.duplicates[0] ? result.duplicates[0].keptLibraryId : null);
          if (!savedId) throw Object.assign(new Error('Record could not be saved.'), { status: 400 });
          return docs.get('swipes', savedId).then(function (row) {
            send(res, result.upserted[0] && result.upserted[0].created ? 201 : 200, {
              ok: true, record: row, url: mediaRow.url, thumbnailUrl: record.thumbnailUrl || '',
              media: { id: mediaRow.id, hash: mediaRow.hash, duplicate: !!m.duplicate },
              dedupe: result.duplicates[0] ? { mergedInto: result.duplicates[0].keptLibraryId, reason: result.duplicates[0].reason } : null
            });
          });
        });
      });
    });
  }).catch(function (e) {
    if (e && e.code === 'TOO_LARGE') return send(res, 413, { error: 'Request is too large. Keep media under 3.5 MB or send metadata.mediaUrl instead.' });
    if (e && e.status) return send(res, e.status, { error: e.message });
    fail(res, e);
  });
}

// ---- AdBuilder API key: what Hermes uses to call THIS app. Stored hashed, shown in full once. ----
function hashKey(key) { return crypto.createHash('sha256').update(String(key)).digest('hex'); }
function apiKey(req, res, body) {
  if (req.method === 'GET') {
    return docs.get('settings', 'apikey').then(function (row) {
      send(res, 200, { set: !!(row && row.hash), masked: row && row.hash ? row.prefix + '…' + row.last4 : '', createdAt: row ? row.createdAt : null,
        lastSeenAt: row ? row.lastSeenAt || null : null, lastPath: row ? row.lastPath || '' : '', lastAgent: row ? row.lastAgent || '' : '' });
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'POST') {           // generate or replace
    var key = 'adbk_' + crypto.randomBytes(24).toString('hex');
    var meta = { hash: hashKey(key), prefix: key.slice(0, 9), last4: key.slice(-4) };
    return docs.put('settings', 'apikey', meta).then(function (row) {
      send(res, 200, { key: key, set: true, masked: meta.prefix + '…' + meta.last4, createdAt: row.createdAt });
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'DELETE') {
    return docs.remove('settings', 'apikey').then(function () { send(res, 200, { set: false, masked: '' }); }, function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, POST, DELETE');
}
// Checks the key on inbound calls from Hermes. Resolves true/false.
function keyAllowed(req) {
  var header = String(req.headers['authorization'] || '');
  var given = /^Bearer\s+(.+)$/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : String(req.headers['x-api-key'] || '').trim();
  if (!given) return Promise.resolve(false);
  return docs.get('settings', 'apikey').then(function (row) {
    if (!row || !row.hash) return false;
    var a = Buffer.from(hashKey(given), 'hex'), b = Buffer.from(row.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
function guarded(handler) {
  return function (req, res, id, body, query) {
    return keyAllowed(req).then(function (ok) {
      if (!ok) return send(res, 401, { error: 'Missing or invalid API key. Send it as "Authorization: Bearer <key>" or "X-API-Key: <key>".' });
      // Remember that Hermes reached us, so the token card can confirm the connection.
      docs.get('settings', 'apikey').then(function (row) {
        if (!row) return;
        row.lastSeenAt = Date.now(); row.lastPath = req.method + ' ' + String(req.url || '').split('?')[0];
        row.lastAgent = str(req.headers['user-agent'], 120);
        return docs.put('settings', 'apikey', row);
      }).catch(function () {});
      return handler(req, res, id, body, query);
    }, function (e) { fail(res, e); });
  };
}

// ---- Inbound API for Hermes (all key-protected) ----
var inbound = {
  // GET /api/v1/ping -> lets Hermes confirm the key works
  ping: guarded(function (req, res) {
    send(res, 200, { ok: true, app: 'adbuilder', time: new Date().toISOString() });
  }),
  // GET /api/v1/campaigns -> campaigns with their status
  campaigns: guarded(function (req, res) {
    docs.list('campaigns').then(function (rows) {
      send(res, 200, rows.map(function (r) { return { id: r.id, name: r.name, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt }; }));
    }, function (e) { fail(res, e); });
  }),
  // GET /api/v1/campaigns/:id -> the full launch payload: prompt, structured data, asset links
  campaign: guarded(function (req, res, id) {
    if (!validId(id)) return send(res, 404, { error: 'Campaign not found.' });
    Promise.all([loadForHermes(id), hermes.config()]).then(function (r) {
      if (!r[0]) return send(res, 404, { error: 'Campaign not found.' });
      send(res, 200, hermes.payload(r[0].campaign, r[0].account, r[0].creatives, r[1].publicBaseUrl || baseUrl(req)));
    }, function (e) { fail(res, e); });
  }),
  // PUT/POST /api/v1/meta { adAccounts: [{id,name}], pixels: [{id,name}], pages: [{id,name}] } -> Hermes syncs the Meta catalog in
  meta: guarded(function (req, res, id, body) {
    if (req.method === 'GET') return readMeta().then(function (m) { send(res, 200, m); }, function (e) { fail(res, e); });
    if (req.method !== 'PUT' && req.method !== 'POST') return notAllowed(res, 'GET, PUT, POST');
    storeMeta(body).then(function (counts) {
      if (!Object.keys(counts).length) return send(res, 400, { error: 'Send at least one of adAccounts, pixels, pages as arrays of { id, name }.' });
      send(res, 200, { ok: true, counts: counts });
    }, function (e) { fail(res, e); });
  }),
  // GET/PUT /api/v1/swipes -> Hermes lists what is stored (ids + hashes) and upserts Meta Ad Library creatives
  swipes: guarded(function (req, res, id, body) {
    if (req.method === 'GET') {
      return docs.list('swipes').then(function (rows) {
        send(res, 200, rows.map(function (r) { return { libraryId: r.id, mediaHash: r.mediaHash, aliasLibraryIds: r.aliasLibraryIds || [], active: r.active, lastSeenAt: r.lastSeenAt, updatedAt: r.updatedAt }; }));
      }, function (e) { fail(res, e); });
    }
    return swipes(req, res, body);
  }),
  // POST /api/creatives/import and /api/v1/creatives/import -> media + thumbnail + metadata in one call
  importCreative: guarded(function (req, res, id, body) { return importCreative(req, res, body); }),
  // POST /api/v1/creatives -> same as POST /api/creatives (upload media, deduped by hash), for Hermes
  creatives: guarded(function (req, res, id, body) { return creatives(req, res, body); }),
  // POST /api/v1/campaigns/:id/status { status: "launched"|"ready"|"draft", message?, externalId? } -> Hermes reports back
  status: guarded(function (req, res, id, body) {
    if (req.method !== 'POST') return notAllowed(res, 'POST');
    if (!validId(id)) return send(res, 404, { error: 'Campaign not found.' });
    body = body || {};
    docs.get('campaigns', id).then(function (camp) {
      if (!camp) return send(res, 404, { error: 'Campaign not found.' });
      var status = ['draft', 'ready', 'launched'].indexOf(body.status) !== -1 ? body.status : camp.status;
      var data = camp.data || {};
      data.hermes = Object.assign({}, data.hermes || {}, { reportedAt: Date.now(), status: status, message: str(body.message, 2000), externalId: str(body.externalId, 200) });
      return docs.put('campaigns', id, { name: camp.name, status: status, data: data }).then(function (row) { send(res, 200, { ok: true, id: row.id, status: row.status }); });
    }).catch(function (e) { fail(res, e); });
  })
};

// ---- Hermes agent (integration layer; endpoint shapes are configurable, see lib/hermes.js) ----
function loadForHermes(id) {
  return Promise.all([docs.get('campaigns', id), accounts.list(), docs.list('creatives')]).then(function (r) {
    var camp = r[0];
    if (!camp) return null;
    var account = null;
    r[1].forEach(function (a) { if (a.id === camp.data.accountId) account = a; });
    return { campaign: camp, account: account, creatives: r[2] };
  });
}
function hermesLaunch(req, res, body) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  var id = body && body.campaignId;
  if (!validId(id)) return send(res, 400, { error: 'campaignId is required.' });
  return loadForHermes(id).then(function (ctx) {
    if (!ctx) return send(res, 404, { error: 'Campaign not found.' });
    return hermes.launch(ctx.campaign, ctx.account, ctx.creatives, baseUrl(req)).then(function (reply) {
      var meta = { name: ctx.campaign.name, status: 'launched', data: ctx.campaign.data };
      meta.data.launch = { at: Date.now(), hermesStatus: reply.status, hermesReply: reply.body };
      return docs.put('campaigns', id, meta).then(function (row) { send(res, 200, { ok: true, campaign: row, reply: reply }); });
    });
  }).catch(function (e) {
    if (e && e.code === 'NOT_CONFIGURED') return send(res, 501, { error: e.message });
    if (e && e.code === 'HERMES_ERROR') return send(res, 502, { error: e.message, reply: e.reply });
    if (e && e.code === 'UNREACHABLE') return send(res, 502, { error: e.message });
    fail(res, e);
  });
}
// What Launch would send, without sending it.
function hermesPreview(req, res, body, query) {
  var id = (body && body.campaignId) || (query && query.campaignId);
  if (!validId(id)) return send(res, 400, { error: 'campaignId is required.' });
  return Promise.all([loadForHermes(id), hermes.config()]).then(function (r) {
    if (!r[0]) return send(res, 404, { error: 'Campaign not found.' });
    var cfg = r[1];
    var p = hermes.payload(r[0].campaign, r[0].account, r[0].creatives, cfg.publicBaseUrl || baseUrl(req));
    send(res, 200, { request: 'POST ' + (cfg.url || '<Hermes URL>') + cfg.launchPath, payload: p });
  }).catch(function (e) { fail(res, e); });
}
function hermesTest(req, res) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  return hermes.test().then(function (r) { send(res, 200, r); }).catch(function (e) {
    if (e && e.code === 'NOT_CONFIGURED') return send(res, 501, { error: e.message });
    if (e && e.code === 'UNREACHABLE') return send(res, 502, { error: e.message });
    fail(res, e);
  });
}
function hermesAccounts(req, res) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  return hermes.pullAccounts().then(function (pulled) {
    return accounts.list().then(function (existing) {
      var seen = {};
      existing.forEach(function (a) { seen[(a.link || '').toLowerCase()] = true; seen['name:' + a.client.toLowerCase()] = true; });
      var added = [];
      return pulled.reduce(function (chain, item) {
        return chain.then(function () {
          var key = (item.link || '').toLowerCase();
          if ((key && seen[key]) || seen['name:' + item.client.toLowerCase()]) return;
          var clean = accounts.clean(item);
          if (!clean) return;
          return accounts.create(clean).then(function (row) { added.push(row); });
        });
      }, Promise.resolve()).then(function () { send(res, 200, { ok: true, pulled: pulled.length, added: added.length }); });
    });
  }).catch(function (e) {
    if (e && e.code === 'NOT_CONFIGURED') return send(res, 501, { error: e.message });
    send(res, 502, { error: 'Hermes request failed: ' + e.message });
  });
}

// ---- AI brain (OpenAI API key) ----
function aiSettings(req, res, body) {
  if (req.method === 'GET') return ai.load().then(function (cfg) { send(res, 200, ai.publicView(cfg)); }, function (e) { fail(res, e); });
  if (req.method === 'PUT') {
    body = body || {};
    return ai.load().then(function (cfg) {
      if (cfg.source === 'env') return send(res, 400, { error: 'The key is set through the OPENAI_API_KEY environment variable on the host.' });
      if (body.apiKey) cfg.apiKey = str(body.apiKey, 300).trim();
      if (body.clearApiKey) cfg.apiKey = '';
      if (body.model != null) cfg.model = str(body.model, 100).trim();
      return ai.save(cfg).then(function () { send(res, 200, ai.publicView(cfg)); });
    }).catch(function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, PUT');
}
function aiTest(req, res) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  ai.test().then(function (r) { send(res, 200, r); }, function (e) { send(res, e.code === 'NOT_CONFIGURED' ? 501 : 502, { error: e.message }); });
}
// POST /api/ai/generate { campaignId, brief, what: "all"|"copy"|"headlines" }
function aiGenerate(req, res, body) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  body = body || {};
  var brief = str(body.brief, 4000).trim();
  if (!validId(body.campaignId)) return send(res, 400, { error: 'campaignId is required.' });
  return docs.get('campaigns', body.campaignId).then(function (camp) {
    if (!camp) return send(res, 404, { error: 'Campaign not found.' });
    if (body.what === 'copy' || body.what === 'headlines') {
      return ai.generateList(body.what, brief || (camp.data && camp.data.brief) || '', camp).then(function (r) { send(res, 200, r); });
    }
    if (!brief) return send(res, 400, { error: 'Write a short brief first: what is being sold, to whom, and the offer.' });
    return readMeta().then(function (m) {
      return ai.buildCampaign(brief, camp, { pages: m.pages.items }).then(function (result) { send(res, 200, { result: result }); });
    });
  }).catch(function (e) { send(res, e.code === 'NOT_CONFIGURED' ? 501 : e.code === 'NEEDS_INPUT' ? 400 : 502, { error: e.message }); });
}

module.exports = {
  aiSettings: aiSettings, aiTest: aiTest, aiGenerate: aiGenerate,
  campaigns: campaigns, campaign: campaign,
  creatives: creatives, creative: creative,
  settings: settings,
  hermesLaunch: hermesLaunch, hermesAccounts: hermesAccounts, hermesTest: hermesTest, hermesPreview: hermesPreview,
  apiKey: apiKey, inbound: inbound, meta: meta, hermesMeta: hermesMeta,
  swipes: swipes, swipe: swipe
};
