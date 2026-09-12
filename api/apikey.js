var api = require('../lib/api');
module.exports = function (req, res) { api.apiKey(req, res, req.body); };
