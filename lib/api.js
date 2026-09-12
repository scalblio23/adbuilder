// Request handlers for campaigns, creatives, settings, and the Hermes integration.
// Used by both server.js and the Vercel functions under api/.
var docs = require('./docs');
var accounts = require('./store');
var hermes = require('./hermes');

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
function settings(req, res, body) {
  if (req.method === 'GET') {
    return hermes.config().then(function (cfg) {
      send(res, 200, { hermesUrl: cfg.url, hermesKeyMasked: maskKey(cfg.key), hermesConfigured: !!(cfg.url && cfg.key), source: cfg.source });
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'PUT') {
    body = body || {};
    return docs.get('settings', 'hermes').then(function (existing) {
      var meta = { url: str(body.hermesUrl != null ? body.hermesUrl : (existing && existing.url), 500).trim().replace(/\/+$/, '') };
      meta.key = body.hermesKey != null && body.hermesKey !== '' ? str(body.hermesKey, 500).trim() : (existing ? existing.key : '');
      if (body.hermesKey === '' && body.clearKey) meta.key = '';
      return docs.put('settings', 'hermes', meta).then(function () {
        send(res, 200, { hermesUrl: meta.url, hermesKeyMasked: maskKey(meta.key), hermesConfigured: !!(meta.url && meta.key), source: 'settings' });
      });
    }).catch(function (e) { fail(res, e); });
  }
  notAllowed(res, 'GET, PUT');
}

// ---- Hermes agent (integration layer; endpoint shapes are configurable, see lib/hermes.js) ----
function hermesLaunch(req, res, body) {
  if (req.method !== 'POST') return notAllowed(res, 'POST');
  var id = body && body.campaignId;
  if (!validId(id)) return send(res, 400, { error: 'campaignId is required.' });
  return Promise.all([docs.get('campaigns', id), accounts.list()]).then(function (results) {
    var camp = results[0];
    if (!camp) return send(res, 404, { error: 'Campaign not found.' });
    var account = null;
    results[1].forEach(function (a) { if (a.id === camp.data.accountId) account = a; });
    return hermes.launch(camp, account).then(function (result) {
      var meta = { name: camp.name, status: 'launched', data: camp.data };
      meta.data.launch = { at: Date.now(), hermes: result };
      return docs.put('campaigns', id, meta).then(function (row) { send(res, 200, { ok: true, campaign: row, hermes: result }); });
    });
  }).catch(function (e) {
    if (e && e.code === 'NOT_CONFIGURED') return send(res, 501, { error: e.message });
    send(res, 502, { error: 'Hermes request failed: ' + e.message });
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
  hermesLaunch: hermesLaunch, hermesAccounts: hermesAccounts
};
