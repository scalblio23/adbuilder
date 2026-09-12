// Database connection shared by every store.
// - DATABASE_URL pointing at Neon: queries go over Neon's HTTPS driver (safe in serverless).
// - Any other DATABASE_URL: node-postgres pool.
// - No DATABASE_URL: db.enabled is false and stores fall back to JSON files.

var DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

function isTransient(err) {
  var msg = String(err && err.message || '');
  var code = err && err.code;
  return /ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|socket|terminated|timeout|TLS|fetch failed/i.test(msg) ||
    code === '57P01' || code === '57P02' || code === '57P03' || code === '08006' || code === '08001';
}

var runQuery = null;
if (DB_URL && /neon\.tech/i.test(DB_URL)) {
  var neon = require('@neondatabase/serverless').neon;
  var sql = neon(DB_URL, { fullResults: true });
  runQuery = function (text, params) { return sql.query(text, params || []); };
} else if (DB_URL) {
  var Pool = require('pg').Pool;
  var pool = new Pool({
    connectionString: DB_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });
  pool.on('error', function (err) { console.error('Idle database connection error:', err.message); });
  runQuery = function (text, params) { return pool.query(text, params || []); };
}

// Retry once on transient network errors (a dropped socket, a database waking up).
function query(text, params) {
  return runQuery(text, params).catch(function (err) {
    if (!isTransient(err)) throw err;
    return new Promise(function (resolve) { setTimeout(resolve, 400); }).then(function () { return runQuery(text, params); });
  });
}

// One-time setup per store, keyed by name; a failure is retried on the next call.
var setups = {};
function ensure(name, fn) {
  if (!setups[name]) {
    setups[name] = Promise.resolve().then(fn).catch(function (err) {
      console.error('Database setup failed (' + name + '):', err.message);
      delete setups[name];
      throw err;
    });
    setups[name].catch(function () {});
  }
  return setups[name];
}

module.exports = { enabled: !!runQuery, query: query, ensure: ensure };
