var api = require('../../../../lib/api');
module.exports = function (req, res) { api.inbound.status(req, res, req.query.id, req.body); };
