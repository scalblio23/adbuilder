// Request handlers for campaigns, creatives, settings, and the Hermes integration.
// Used by both server.js and the Vercel functions under api/.
var docs = require('./docs');
var accounts = require('./store');
var hermes = require('./hermes');

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
function creatives(req, res, body) {
  if (req.method === 'GET') {
    return docs.list('creatives').then(function (rows) { send(res, 200, rows); }, function (e) { fail(res, e); });
  }
  if (req.method === 'POST') {
    body = body || {};
    var name = str(body.name, 200).trim();
    if (!name) return send(res, 400, { error: 'Creative name is required.' });
    var meta = { name: name, mime: str(body.mime, 100), url: str(body.url, 2000).trim(), size: 0 };
    var blob;
    if (body.data) {
      if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/=\r\n]+$/.test(body.data)) return send(res, 400, { error: 'Upload must be base64.' });
      blob = body.data.replace(/[\r\n]/g, '');
      meta.size = Math.floor(blob.length * 3 / 4);
      if (meta.size > MAX_CREATIVE_BYTES) return send(res, 413, { error: 'File is too large. Keep uploads under 3.5 MB or link to the file instead.' });
      if (!/^(image|video)\//.test(meta.mime)) return send(res, 400, { error: 'Only image and video files can be uploaded.' });
    } else if (!meta.url) {
      return send(res, 400, { error: 'Upload a file or provide a URL.' });
    } else if (!/^https?:\/\//i.test(meta.url)) meta.url = 'https://' + meta.url;
    return docs.put('creatives', docs.newId(), meta, blob).then(function (row) { send(res, 201, row); }, function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, POST');
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

// ---- AdBuilder API key: what Hermes uses to call THIS app. Stored hashed, shown in full once. ----
function hashKey(key) { return crypto.createHash('sha256').update(String(key)).digest('hex'); }
function apiKey(req, res, body) {
  if (req.method === 'GET') {
    return docs.get('settings', 'apikey').then(function (row) {
      send(res, 200, { set: !!(row && row.hash), masked: row && row.hash ? row.prefix + '…' + row.last4 : '', createdAt: row ? row.createdAt : null });
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

module.exports = {
  campaigns: campaigns, campaign: campaign,
  creatives: creatives, creative: creative,
  settings: settings,
  hermesLaunch: hermesLaunch, hermesAccounts: hermesAccounts, hermesTest: hermesTest, hermesPreview: hermesPreview,
  apiKey: apiKey, inbound: inbound
};
