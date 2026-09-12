// Minimal multipart/form-data parser: returns { fields: {name: string}, files: {name: {filename, mime, buffer}} }.
// Reads the raw request body (or uses a pre-read Buffer/string when the host already consumed the stream).

function readRaw(req, limit) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string' && req.body) return Promise.resolve(Buffer.from(req.body, 'binary'));
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) { size += c.length; if (size > limit) { reject(Object.assign(new Error('Request body is too large.'), { code: 'TOO_LARGE' })); req.destroy(); return; } chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function parse(buffer, contentType) {
  var m = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!m) throw new Error('multipart boundary missing');
  var boundary = Buffer.from('--' + m[1]);
  var out = { fields: {}, files: {} };
  var start = buffer.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;      // closing boundary
    var headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    var headers = buffer.slice(start, headerEnd).toString('utf8');
    var next = buffer.indexOf(boundary, headerEnd);
    if (next === -1) break;
    var body = buffer.slice(headerEnd + 4, next - 2);                     // strip trailing CRLF
    var disp = /name="([^"]*)"/i.exec(headers), file = /filename="([^"]*)"/i.exec(headers), type = /content-type:\s*([^\r\n]+)/i.exec(headers);
    var name = disp ? disp[1] : '';
    if (file) out.files[name] = { filename: file[1], mime: (type ? type[1] : 'application/octet-stream').trim(), buffer: body };
    else out.fields[name] = body.toString('utf8');
    start = next;
  }
  return out;
}

module.exports = { readRaw: readRaw, parse: parse };
