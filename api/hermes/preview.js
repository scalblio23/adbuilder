var api = require('../../lib/api');
module.exports = function (req, res) { api.hermesPreview(req, res, req.body, req.query); };
