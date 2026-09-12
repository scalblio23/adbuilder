var api = require('../../lib/api');
module.exports = function (req, res) { api.swipes(req, res, req.body); };
