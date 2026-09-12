var api = require('../../lib/api');
module.exports = function (req, res) { api.aiGenerate(req, res, req.body); };
