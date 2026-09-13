// One route table for every API endpoint, used by server.js and by the single Vercel function api/[...path].js.
var handlers = require('./handlers');
var api = require('./api');
var store = require('./store');

function query(req) {
  var q = {}; String((req.url || '').split('?')[1] || '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  return q;
}

function health(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  var version = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : 'local';
  store.list().then(function (rows) {
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, storage: store.kind, accounts: rows.length, version: version }));
  }, function (err) {
    res.statusCode = 500; res.end(JSON.stringify({ ok: false, storage: store.kind, error: err && err.message, version: version }));
  });
}

// [pattern, handler(req, res, id, body)]
var ROUTES = [
  [/^\/api\/health\/?$/, function (req, res) { health(req, res); }],
  [/^\/api\/ad-accounts(?:\/([^/]+))?\/?$/, function (req, res, id, body) { id ? handlers.item(req, res, id, body) : handlers.collection(req, res, body); }],
  [/^\/api\/campaigns(?:\/([^/]+))?\/?$/, function (req, res, id, body) { id ? api.campaign(req, res, id, body) : api.campaigns(req, res, body); }],
  [/^\/api\/(?:v1\/)?creatives\/import\/?$/, function (req, res, id, body) { api.inbound.importCreative(req, res, null, body); }],
  [/^\/api\/creatives(?:\/([^/]+))?\/?$/, function (req, res, id, body) { id ? api.creative(req, res, id, body) : api.creatives(req, res, body); }],
  [/^\/api\/settings\/webhook-secret\/?$/, function (req, res) { api.webhookSecret(req, res); }],
  [/^\/api\/settings\/?$/, function (req, res, id, body) { api.settings(req, res, body); }],
  [/^\/api\/hermes\/launch\/?$/, function (req, res, id, body) { api.hermesLaunch(req, res, body); }],
  [/^\/api\/hermes\/accounts\/?$/, function (req, res, id, body) { api.hermesAccounts(req, res, body); }],
  [/^\/api\/hermes\/meta\/?$/, function (req, res) { api.hermesMeta(req, res); }],
  [/^\/api\/hermes\/test\/?$/, function (req, res, id, body) { api.hermesTest(req, res, body); }],
  [/^\/api\/hermes\/preview\/?$/, function (req, res, id, body) { api.hermesPreview(req, res, body, query(req)); }],
  [/^\/api\/ai\/settings\/?$/, function (req, res, id, body) { api.aiSettings(req, res, body); }],
  [/^\/api\/ai\/test\/?$/, function (req, res) { api.aiTest(req, res); }],
  [/^\/api\/ai\/generate\/?$/, function (req, res, id, body) { api.aiGenerate(req, res, body); }],
  [/^\/api\/swipes\/?$/, function (req, res, id, body) { api.swipes(req, res, body); }],
  [/^\/api\/swipes\/([^/]+)\/?$/, function (req, res, id, body) { api.swipe(req, res, id, body); }],
  [/^\/api\/meta\/?$/, function (req, res) { api.meta(req, res); }],
  [/^\/api\/apikey\/?$/, function (req, res, id, body) { api.apiKey(req, res, body); }],
  [/^\/api\/v1\/ping\/?$/, function (req, res) { api.inbound.ping(req, res); }],
  [/^\/api\/v1\/campaigns\/?$/, function (req, res) { api.inbound.campaigns(req, res); }],
  [/^\/api\/v1\/campaigns\/([^/]+)\/status\/?$/, function (req, res, id, body) { api.inbound.status(req, res, id, body); }],
  [/^\/api\/v1\/campaigns\/([^/]+)\/?$/, function (req, res, id) { api.inbound.campaign(req, res, id); }],
  [/^\/api\/v1\/meta\/?$/, function (req, res, id, body) { api.inbound.meta(req, res, null, body); }],
  [/^\/api\/v1\/swipes\/?$/, function (req, res, id, body) { api.inbound.swipes(req, res, null, body); }],
  [/^\/api\/v1\/creatives\/?$/, function (req, res, id, body) { api.inbound.creatives(req, res, null, body); }]
];

function isMultipart(req) { return /multipart\/form-data/i.test(String(req.headers['content-type'] || '')); }

// Finds the route for req. Returns { handler, id } or null.
function match(req) {
  var pathname = (req.url || '').split('?')[0];
  for (var i = 0; i < ROUTES.length; i++) {
    var m = ROUTES[i][0].exec(pathname);
    if (m) return { handler: ROUTES[i][1], id: m[1] };
  }
  return null;
}

module.exports = { ROUTES: ROUTES, match: match, isMultipart: isMultipart, health: health };
