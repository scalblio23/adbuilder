// AdBuilder server: serves the dashboard and a shared Ad Accounts API.
// No dependencies. Run with `npm start` (or `node server.js`).
//
// Data is stored in DATA_DIR/ad-accounts.json (DATA_DIR defaults to ./data).
// Point DATA_DIR at a persistent volume on your host so data survives restarts.

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var PORT = parseInt(process.env.PORT, 10) || 8080;
var ROOT = __dirname;
var DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
var DATA_FILE = path.join(DATA_DIR, 'ad-accounts.json');
var MAX_BODY = 64 * 1024;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ---- Storage ----
function readAccounts() {
  try {
    var parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeAccounts(accounts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  var tmp = DATA_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---- Helpers ----
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, callback) {
  var chunks = [];
  var size = 0;
  req.on('data', function (chunk) {
    size += chunk.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', function () {
    try { callback(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
    catch (e) { callback(e); }
  });
  req.on('error', callback);
}

function cleanAccount(input) {
  if (!input || typeof input !== 'object') return null;
  var client = String(input.client || '').trim();
  var company = String(input.company || '').trim();
  var link = String(input.link || '').trim();
  if (!client) return null;
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (client.length > 200 || company.length > 200 || link.length > 2000) return null;
  return { client: client, company: company, link: link };
}

// ---- API: /api/ad-accounts and /api/ad-accounts/:id ----
function handleApi(req, res, id) {
  var accounts = readAccounts();

  if (!id && req.method === 'GET') return sendJson(res, 200, accounts);

  if (!id && req.method === 'POST') {
    return readBody(req, function (err, body) {
      var clean = err ? null : cleanAccount(body);
      if (!clean) return sendJson(res, 400, { error: 'Client name is required.' });
      clean.id = crypto.randomBytes(8).toString('hex');
      clean.createdAt = Date.now();
      clean.updatedAt = clean.createdAt;
      accounts.push(clean);
      writeAccounts(accounts);
      sendJson(res, 201, clean);
    });
  }

  if (id) {
    var index = -1;
    for (var i = 0; i < accounts.length; i++) if (accounts[i].id === id) { index = i; break; }
    if (index === -1) return sendJson(res, 404, { error: 'Account not found.' });

    if (req.method === 'PUT') {
      return readBody(req, function (err, body) {
        var clean = err ? null : cleanAccount(body);
        if (!clean) return sendJson(res, 400, { error: 'Client name is required.' });
        clean.id = id;
        clean.createdAt = accounts[index].createdAt;
        clean.updatedAt = Date.now();
        accounts[index] = clean;
        writeAccounts(accounts);
        sendJson(res, 200, clean);
      });
    }

    if (req.method === 'DELETE') {
      accounts.splice(index, 1);
      writeAccounts(accounts);
      return sendJson(res, 200, { ok: true });
    }
  }

  res.writeHead(405, { Allow: id ? 'PUT, DELETE' : 'GET, POST' });
  res.end();
}

// ---- Static files ----
function serveStatic(req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var filePath = path.normalize(path.join(ROOT, urlPath));
  var inRoot = filePath.indexOf(ROOT + path.sep) === 0;
  var blocked = filePath.indexOf(DATA_DIR) === 0 || path.basename(filePath) === 'server.js' || /(^|\/)\./.test(urlPath);
  if (!inRoot || blocked) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(filePath, function (err, content) {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

http.createServer(function (req, res) {
  var match = /^\/api\/ad-accounts(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(req.url.split('?')[0]);
  if (match) return handleApi(req, res, match[1]);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
}).listen(PORT, function () {
  console.log('AdBuilder running on port ' + PORT);
  console.log('Ad accounts stored in ' + DATA_FILE);
});
