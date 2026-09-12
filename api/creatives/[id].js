var api = require('../../lib/api');
module.exports = function (req, res) { api.creative(req, res, req.query.id, req.body); };
