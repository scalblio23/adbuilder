var api = require('../../lib/api');
module.exports = function (req, res) { api.campaigns(req, res, req.body); };
