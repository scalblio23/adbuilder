var api = require('../../lib/api');
module.exports = function (req, res) { api.swipe(req, res, req.query.id, req.body); };
