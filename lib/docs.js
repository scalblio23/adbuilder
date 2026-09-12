// Generic document store used for campaigns, creatives, and settings.
// Each document has an id, a small JSON "meta" object, and an optional large "blob" string
// (base64 file contents) that is only loaded when asked for.
//
// Postgres: one "documents" table. Files: DATA_DIR/<collection>.json plus DATA_DIR/blobs/.

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var db = require('./db');

function newId() { return crypto.randomBytes(8).toString('hex'); }

function postgresDocs() {
  function setup() {
    return db.query(
      'CREATE TABLE IF NOT EXISTS documents (' +
      ' collection TEXT NOT NULL,' +
      ' id TEXT NOT NULL,' +
      ' meta TEXT NOT NULL,' +
      ' blob TEXT,' +
      ' created_at BIGINT NOT NULL,' +
      ' updated_at BIGINT NOT NULL,' +
      ' PRIMARY KEY (collection, id))'
    );
  }
  function q(text, params) { return db.ensure('documents', setup).then(function () { return db.query(text, params); }); }
  function row(r, withBlob) {
    var doc = JSON.parse(r.meta);
    doc.id = r.id; doc.createdAt = Number(r.created_at); doc.updatedAt = Number(r.updated_at);
    if (withBlob) doc.blob = r.blob || '';
    return doc;
  }
  return {
    list: function (collection) {
      return q('SELECT collection, id, meta, created_at, updated_at FROM documents WHERE collection=$1 ORDER BY created_at ASC', [collection])
        .then(function (r) { return r.rows.map(function (x) { return row(x, false); }); });
    },
    get: function (collection, id, withBlob) {
      var cols = withBlob ? '*' : 'collection, id, meta, created_at, updated_at';
      return q('SELECT ' + cols + ' FROM documents WHERE collection=$1 AND id=$2', [collection, id])
        .then(function (r) { return r.rows[0] ? row(r.rows[0], withBlob) : null; });
    },
    put: function (collection, id, meta, blob) {
      var now = Date.now();
      var clean = Object.assign({}, meta); delete clean.id; delete clean.createdAt; delete clean.updatedAt; delete clean.blob;
      var text = JSON.stringify(clean);
      var sql = blob === undefined
        ? 'INSERT INTO documents (collection, id, meta, created_at, updated_at) VALUES ($1,$2,$3,$4,$4) ' +
          'ON CONFLICT (collection, id) DO UPDATE SET meta=EXCLUDED.meta, updated_at=EXCLUDED.updated_at RETURNING collection, id, meta, created_at, updated_at'
        : 'INSERT INTO documents (collection, id, meta, blob, created_at, updated_at) VALUES ($1,$2,$3,$5,$4,$4) ' +
          'ON CONFLICT (collection, id) DO UPDATE SET meta=EXCLUDED.meta, blob=EXCLUDED.blob, updated_at=EXCLUDED.updated_at RETURNING collection, id, meta, created_at, updated_at';
      var params = blob === undefined ? [collection, id, text, now] : [collection, id, text, now, blob];
      return q(sql, params).then(function (r) { return row(r.rows[0], false); });
    },
    remove: function (collection, id) {
      return q('DELETE FROM documents WHERE collection=$1 AND id=$2', [collection, id]).then(function (r) { return r.rowCount > 0; });
    }
  };
}

function fileDocs() {
  var dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  function file(collection) { return path.join(dir, collection + '.json'); }
  function blobFile(collection, id) { return path.join(dir, 'blobs', collection + '-' + id); }
  function read(collection) {
    try { var parsed = JSON.parse(fs.readFileSync(file(collection), 'utf8')); return Array.isArray(parsed) ? parsed : []; }
    catch (e) { return []; }
  }
  function write(collection, rows) {
    fs.mkdirSync(dir, { recursive: true });
    var tmp = file(collection) + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2));
    fs.renameSync(tmp, file(collection));
  }
  function find(rows, id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return i; return -1; }
  return {
    list: function (collection) { return Promise.resolve(read(collection)); },
    get: function (collection, id, withBlob) {
      var rows = read(collection); var i = find(rows, id);
      if (i === -1) return Promise.resolve(null);
      var doc = Object.assign({}, rows[i]);
      if (withBlob) { try { doc.blob = fs.readFileSync(blobFile(collection, id), 'utf8'); } catch (e) { doc.blob = ''; } }
      return Promise.resolve(doc);
    },
    put: function (collection, id, meta, blob) {
      var rows = read(collection); var i = find(rows, id); var now = Date.now();
      var clean = Object.assign({}, meta); delete clean.blob;
      var doc = Object.assign(clean, { id: id, createdAt: i === -1 ? now : rows[i].createdAt, updatedAt: now });
      if (i === -1) rows.push(doc); else rows[i] = doc;
      write(collection, rows);
      if (blob !== undefined) { fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true }); fs.writeFileSync(blobFile(collection, id), blob); }
      return Promise.resolve(doc);
    },
    remove: function (collection, id) {
      var rows = read(collection); var i = find(rows, id);
      if (i === -1) return Promise.resolve(false);
      rows.splice(i, 1); write(collection, rows);
      try { fs.unlinkSync(blobFile(collection, id)); } catch (e) {}
      return Promise.resolve(true);
    }
  };
}

var docs = db.enabled ? postgresDocs() : fileDocs();
docs.newId = newId;
module.exports = docs;
