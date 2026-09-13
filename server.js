// AdBuilder server for local use and hosts that run a Node process (Railway, Fly.io, Docker).
// On Vercel the api/ folder is used instead and this file is ignored.
//
// Storage: Postgres when DATABASE_URL is set, otherwise DATA_DIR/ad-accounts.json.

var http = require('http');
var fs = require('fs');
var path = require('path');
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


var router = require('./lib/router');

http.createServer(function (req, res) {
  var found = router.match(req);
  if (found) {
    if (router.isMultipart(req)) return found.handler(req, res, found.id, undefined);
    return readBody(req, function (body) { found.handler(req, res, found.id, body); });
  }
  if (/^\/api\//.test((req.url || '').split('?')[0])) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'No such API route' })); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
}).listen(PORT, function () {
  console.log('AdBuilder running on port ' + PORT);
  console.log('Ad accounts stored in ' + (store.kind === 'postgres' ? 'Postgres' : store.file));
});
