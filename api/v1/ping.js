var api = require('../../lib/api');
module.exports = function (req, res) { api.inbound.ping(req, res); };
