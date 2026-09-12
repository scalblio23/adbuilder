var api = require('../../lib/api');
// Multipart bodies are read from the stream; JSON bodies come parsed on req.body.
module.exports = function (req, res) {
  var isMultipart = /multipart\/form-data/i.test(String(req.headers['content-type'] || ''));
  api.inbound.importCreative(req, res, null, isMultipart ? undefined : req.body);
};
