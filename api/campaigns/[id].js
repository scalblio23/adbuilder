var api = require('../../lib/api');
module.exports = function (req, res) { api.campaign(req, res, req.query.id, req.body); };
