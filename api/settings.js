var api = require('../lib/api');
module.exports = function (req, res) { api.settings(req, res, req.body); };
