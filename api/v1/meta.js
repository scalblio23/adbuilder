var api = require('../../lib/api');
module.exports = function (req, res) { api.inbound.meta(req, res, null, req.body); };
