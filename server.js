// AdBuilder server for local use and hosts that run a Node process (Railway, Fly.io, Docker).
// On Vercel the api/ folder is used instead and this file is ignored.
//
// Storage: Postgres when DATABASE_URL is set, otherwise DATA_DIR/ad-accounts.json.

var http = require('http');
var fs = require('fs');
var path = require('path');
var handlers = require('./lib/handlers');
var api = require('./lib/api');
var store = require('./lib/store');

var PORT = parseInt(process.env.PORT, 10) || 8080;
var ROOT = path.join(__dirname, 'public');
var MAX_BODY = 6 * 1024 * 1024;   // creative uploads are sent as base64 JSON

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readBody(req, callback) {
  var chunks = [];
  var size = 0;
  req.on('data', function (chunk) {
    size += chunk.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', function () {
    try { callback(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch (e) { callback(null); }
  });
}

function serveStatic(req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var filePath = path.normalize(path.join(ROOT, urlPath));
  var inRoot = filePath.indexOf(ROOT + path.sep) === 0;   // everything under public/ is public
  if (!inRoot || /(^|\/)\./.test(urlPath)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(filePath, function (err, content) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

var health = require('./api/health');

// API routes: [pattern, handler(req, res, id, body)]
var ROUTES = [
  [/^\/api\/ad-accounts(?:\/([^/]+))?\/?$/, function (req, res, id, body) { id ? handlers.item(req, res, id, body) : handlers.collection(req, res, body); }],
  [/^\/api\/campaigns(?:\/([^/]+))?\/?$/, function (req, res, id, body) { id ? api.campaign(req, res, id, body) : api.campaigns(req, res, body); }],
  [/^\/api\/creatives(?:\/([^/]+))?\/?$/, function (req, res, id, body) { id ? api.creative(req, res, id, body) : api.creatives(req, res, body); }],
  [/^\/api\/settings\/webhook-secret\/?$/, function (req, res) { api.webhookSecret(req, res); }],
  [/^\/api\/settings\/?$/, function (req, res, id, body) { api.settings(req, res, body); }],
  [/^\/api\/hermes\/launch\/?$/, function (req, res, id, body) { api.hermesLaunch(req, res, body); }],
  [/^\/api\/hermes\/accounts\/?$/, function (req, res, id, body) { api.hermesAccounts(req, res, body); }],
  [/^\/api\/ai\/settings\/?$/, function (req, res, id, body) { api.aiSettings(req, res, body); }],
  [/^\/api\/ai\/test\/?$/, function (req, res) { api.aiTest(req, res); }],
  [/^\/api\/ai\/generate\/?$/, function (req, res, id, body) { api.aiGenerate(req, res, body); }],
  [/^\/api\/swipes\/?$/, function (req, res, id, body) { api.swipes(req, res, body); }],
  [/^\/api\/swipes\/([^/]+)\/?$/, function (req, res, id, body) { api.swipe(req, res, id, body); }],
  [/^\/api\/v1\/swipes\/?$/, function (req, res, id, body) { api.inbound.swipes(req, res, null, body); }],
  [/^\/api\/v1\/creatives\/?$/, function (req, res, id, body) { api.inbound.creatives(req, res, null, body); }],
  [/^\/api\/meta\/?$/, function (req, res) { api.meta(req, res); }],
  [/^\/api\/v1\/meta\/?$/, function (req, res, id, body) { api.inbound.meta(req, res, null, body); }],
  [/^\/api\/hermes\/meta\/?$/, function (req, res) { api.hermesMeta(req, res); }],
  [/^\/api\/apikey\/?$/, function (req, res, id, body) { api.apiKey(req, res, body); }],
  [/^\/api\/v1\/ping\/?$/, function (req, res) { api.inbound.ping(req, res); }],
  [/^\/api\/v1\/campaigns\/?$/, function (req, res) { api.inbound.campaigns(req, res); }],
  [/^\/api\/v1\/campaigns\/([^/]+)\/status\/?$/, function (req, res, id, body) { api.inbound.status(req, res, id, body); }],
  [/^\/api\/v1\/campaigns\/([^/]+)\/?$/, function (req, res, id) { api.inbound.campaign(req, res, id); }],
  [/^\/api\/hermes\/test\/?$/, function (req, res, id, body) { api.hermesTest(req, res, body); }],
  [/^\/api\/hermes\/preview\/?$/, function (req, res, id, body) {
    var q = {}; String(req.url.split('?')[1] || '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    api.hermesPreview(req, res, body, q);
  }]
];

http.createServer(function (req, res) {
  var pathname = req.url.split('?')[0];
  if (pathname === '/api/health') return health(req, res);
  if (/^\/api\/(v1\/)?creatives\/import\/?$/.test(pathname)) {
    if (/multipart\/form-data/i.test(String(req.headers['content-type'] || ''))) return api.inbound.importCreative(req, res, null, undefined);
    return readBody(req, function (body) { api.inbound.importCreative(req, res, null, body); });
  }
  for (var i = 0; i < ROUTES.length; i++) {
    var match = ROUTES[i][0].exec(pathname);
    if (match) {
      var handle = ROUTES[i][1];
      return readBody(req, function (body) { handle(req, res, match[1], body); });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
}).listen(PORT, function () {
  console.log('AdBuilder running on port ' + PORT);
  console.log('Ad accounts stored in ' + (store.kind === 'postgres' ? 'Postgres' : store.file));
});
