// Storage for ad accounts.
// - With DATABASE_URL (or POSTGRES_URL) set, rows live in a Postgres table. Use this on Vercel.
// - Otherwise rows live in DATA_DIR/ad-accounts.json. Fine for local use or hosts with a disk.

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

// Traffic-light status columns. Each holds '', 'green', 'amber', or 'red'.
var STATUS_FIELDS = ['leads', 'bookings', 'conversion', 'mood'];
var STATUS_VALUES = ['', 'green', 'amber', 'red'];

// ---- Validation shared by both backends ----
function clean(input) {
  if (!input || typeof input !== 'object') return null;
  var client = String(input.client || '').trim();
  var company = String(input.company || '').trim();
  var link = String(input.link || '').trim();
  var rules = String(input.rules || '').replace(/\r\n?/g, '\n').trim();
  if (!client) return null;
  if (link) link = withScheme(link);
  if (client.length > 200 || company.length > 200 || link.length > 2000 || rules.length > 10000) return null;
  var out = { client: client, company: company, link: link, rules: rules };
  for (var i = 0; i < STATUS_FIELDS.length; i++) {
    var v = String(input[STATUS_FIELDS[i]] || '').toLowerCase();
    if (STATUS_VALUES.indexOf(v) === -1) return null;
    out[STATUS_FIELDS[i]] = v;
  }
  return out;
}

function withScheme(url) { return /^https?:\/\//i.test(url) ? url : 'https://' + url; }

function newId() { return crypto.randomBytes(8).toString('hex'); }

// ---- Postgres backend ----
function postgresStore() {
  var Pool = require('pg').Pool;
  var pool = new Pool({
    connectionString: DB_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false },
    max: 3
  });
  var ready = pool.query(
    'CREATE TABLE IF NOT EXISTS ad_accounts (' +
    ' id TEXT PRIMARY KEY,' +
    ' client TEXT NOT NULL,' +
    " company TEXT NOT NULL DEFAULT ''," +
    " link TEXT NOT NULL DEFAULT ''," +
    ' created_at BIGINT NOT NULL,' +
    ' updated_at BIGINT NOT NULL)'
  ).then(function () {
    // Columns added after the first release; safe to run every start.
    return pool.query("ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS rules TEXT NOT NULL DEFAULT ''");
  }).then(function () {
    return STATUS_FIELDS.reduce(function (chain, f) {
      return chain.then(function () { return pool.query('ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS ' + f + " TEXT NOT NULL DEFAULT ''"); });
    }, Promise.resolve());
  }).then(function () {
    // A short-lived "urls" column was renamed to "rules"; carry its contents over, then drop it.
    return pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='ad_accounts' AND column_name='urls'").then(function (r) {
      if (!r.rowCount) return;
      return pool.query("UPDATE ad_accounts SET rules = urls WHERE rules = '' AND urls <> ''")
        .then(function () { return pool.query('ALTER TABLE ad_accounts DROP COLUMN urls'); });
    });
  });
  function row(r) {
    var out = { id: r.id, client: r.client, company: r.company, link: r.link, rules: r.rules || '', createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) };
    STATUS_FIELDS.forEach(function (f) { out[f] = r[f] || ''; });
    return out;
  }
  function q(text, params) { return ready.then(function () { return pool.query(text, params); }); }

  return {
    kind: 'postgres',
    list: function () {
      return q('SELECT * FROM ad_accounts ORDER BY created_at ASC').then(function (r) { return r.rows.map(row); });
    },
    create: function (data) {
      var now = Date.now();
      var id = newId();
      return q('INSERT INTO ad_accounts (id, client, company, link, rules, leads, bookings, conversion, mood, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
        [id, data.client, data.company, data.link, data.rules, data.leads, data.bookings, data.conversion, data.mood, now, now]).then(function (r) { return row(r.rows[0]); });
    },
    get: function (id) {
      return q('SELECT * FROM ad_accounts WHERE id=$1', [id]).then(function (r) { return r.rows[0] ? row(r.rows[0]) : null; });
    },
    update: function (id, data) {
      return q('UPDATE ad_accounts SET client=$2, company=$3, link=$4, rules=$5, leads=$6, bookings=$7, conversion=$8, mood=$9, updated_at=$10 WHERE id=$1 RETURNING *',
        [id, data.client, data.company, data.link, data.rules, data.leads, data.bookings, data.conversion, data.mood, Date.now()]).then(function (r) { return r.rows[0] ? row(r.rows[0]) : null; });
    },
    remove: function (id) {
      return q('DELETE FROM ad_accounts WHERE id=$1', [id]).then(function (r) { return r.rowCount > 0; });
    }
  };
}

// ---- JSON file backend ----
function fileStore() {
  var dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  var file = path.join(dir, 'ad-accounts.json');
  function read() {
    try {
      var parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.map(function (r) { if (r.rules === undefined) r.rules = r.urls || ''; delete r.urls; return r; });
    }
    catch (e) { return []; }
  }
  function write(rows) {
    fs.mkdirSync(dir, { recursive: true });
    var tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, file);
  }
  function indexOf(rows, id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return i; return -1; }

  return {
    kind: 'file',
    file: file,
    list: function () { return Promise.resolve(read()); },
    create: function (data) {
      var rows = read();
      var now = Date.now();
      var item = Object.assign({ id: newId() }, data, { createdAt: now, updatedAt: now });
      rows.push(item); write(rows);
      return Promise.resolve(item);
    },
    get: function (id) {
      var rows = read();
      var i = indexOf(rows, id);
      return Promise.resolve(i === -1 ? null : rows[i]);
    },
    update: function (id, data) {
      var rows = read();
      var i = indexOf(rows, id);
      if (i === -1) return Promise.resolve(null);
      rows[i] = Object.assign({ id: id }, data, { createdAt: rows[i].createdAt, updatedAt: Date.now() });
      write(rows);
      return Promise.resolve(rows[i]);
    },
    remove: function (id) {
      var rows = read();
      var i = indexOf(rows, id);
      if (i === -1) return Promise.resolve(false);
      rows.splice(i, 1); write(rows);
      return Promise.resolve(true);
    }
  };
}

var store = DB_URL ? postgresStore() : fileStore();
store.clean = clean;
module.exports = store;
