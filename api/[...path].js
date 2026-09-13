// The one Vercel function for every /api/* route. Vercel parses JSON bodies into req.body;
// multipart bodies are left on the stream for the handler to read.
var router = require('../lib/router');
module.exports = function (req, res) {
  var found = router.match(req);
  if (!found) {
    res.statusCode = 404; res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'No such API route: ' + (req.url || '').split('?')[0] }));
  }
  var body = router.isMultipart(req) ? undefined : (req.body && typeof req.body === 'object' ? req.body : undefined);
  return found.handler(req, res, found.id, body);
};
