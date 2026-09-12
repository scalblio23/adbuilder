var api = require('../../../lib/api');
module.exports = function (req, res) { api.inbound.creatives(req, res, null, req.body); };
