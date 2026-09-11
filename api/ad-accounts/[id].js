// Vercel serverless function: PUT and DELETE /api/ad-accounts/:id
var handlers = require('../../lib/handlers');
module.exports = function (req, res) {
  handlers.item(req, res, req.query.id, req.body);
};
