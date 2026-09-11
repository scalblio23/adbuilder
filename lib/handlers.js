// HTTP handlers for the ad accounts API, shared by server.js and the Vercel routes.
var store = require('./store');

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

// GET /api/ad-accounts, POST /api/ad-accounts
function collection(req, res, body) {
  if (req.method === 'GET') return store.list().then(function (rows) { send(res, 200, rows); }, function (e) { fail(res, e); });
  if (req.method === 'POST') {
    var data = store.clean(body);
    if (!data) return send(res, 400, { error: 'Client name is required.' });
    return store.create(data).then(function (row) { send(res, 201, row); }, function (e) { fail(res, e); });
  }
  res.setHeader('Allow', 'GET, POST');
  send(res, 405, { error: 'Method not allowed' });
}

// PUT /api/ad-accounts/:id, DELETE /api/ad-accounts/:id
function item(req, res, id, body) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id || '')) return send(res, 404, { error: 'Account not found.' });
  if (req.method === 'PUT') {
    var data = store.clean(body);
    if (!data) return send(res, 400, { error: 'Client name is required.' });
    return store.update(id, data).then(function (row) {
      if (!row) return send(res, 404, { error: 'Account not found.' });
      send(res, 200, row);
    }, function (e) { fail(res, e); });
  }
  if (req.method === 'DELETE') {
    return store.remove(id).then(function (ok) {
      if (!ok) return send(res, 404, { error: 'Account not found.' });
      send(res, 200, { ok: true });
    }, function (e) { fail(res, e); });
  }
  res.setHeader('Allow', 'PUT, DELETE');
  send(res, 405, { error: 'Method not allowed' });
}

module.exports = { collection: collection, item: item };
