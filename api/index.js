// The whole API is one Vercel function. vercel.json rewrites every /api/* path here; the router
// reads the original path (kept in req.url by the rewrite, and also passed as ?__path= as a fallback).
var router = require('../lib/router');

module.exports = function (req, res) {
  var found = router.match(req);
  if (!found) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'No such API route: ' + router.pathOf(req) }));
  }
  var body = router.isMultipart(req) ? undefined : (req.body && typeof req.body === 'object' ? req.body : undefined);
  return found.handler(req, res, found.id, body);
};
