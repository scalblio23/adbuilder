var api = require('../../../../lib/api');
module.exports = function (req, res) { api.inbound.campaign(req, res, req.query.id); };
