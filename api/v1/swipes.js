var api = require('../../lib/api');
module.exports = function (req, res) { api.inbound.swipes(req, res, null, req.body); };
