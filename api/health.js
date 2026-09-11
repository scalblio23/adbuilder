// GET /api/health: reports which storage is in use and whether it is reachable.
var store = require('../lib/store');
module.exports = function (req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  store.list().then(function (rows) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, storage: store.kind, accounts: rows.length }));
  }, function (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, storage: store.kind, error: err && err.message }));
  });
};
