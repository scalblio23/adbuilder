// Vercel serverless function: GET and POST /api/ad-accounts
var handlers = require('../../lib/handlers');
module.exports = function (req, res) {
  handlers.collection(req, res, req.body);
};
