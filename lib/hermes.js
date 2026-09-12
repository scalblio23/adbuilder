// Hermes agent integration.
//
// Hermes' API is not yet wired in on their side, so this module is the single place to
// adjust once the endpoint shapes are known. Configure with either:
//   - Settings tab in the app (stored in the database), or
//   - HERMES_URL and HERMES_API_KEY environment variables (take precedence).
//
// Expected endpoints (change HERMES_LAUNCH_PATH / HERMES_ACCOUNTS_PATH env vars if different):
//   POST {url}/campaigns          body: the campaign payload below     -> any JSON
//   GET  {url}/ad-accounts        -> JSON array of { name|client, company?, url|link?, id? }

var docs = require('./docs');

var LAUNCH_PATH = process.env.HERMES_LAUNCH_PATH || '/campaigns';
var ACCOUNTS_PATH = process.env.HERMES_ACCOUNTS_PATH || '/ad-accounts';

function config() {
  if (process.env.HERMES_URL && process.env.HERMES_API_KEY) {
    return Promise.resolve({ url: process.env.HERMES_URL.replace(/\/+$/, ''), key: process.env.HERMES_API_KEY, source: 'env' });
  }
  return docs.get('settings', 'hermes').then(function (row) {
    return { url: (row && row.url) || '', key: (row && row.key) || '', source: 'settings' };
  });
}

function notConfigured() {
  var err = new Error('Hermes is not connected yet. Add the Hermes URL and API key under Settings.');
  err.code = 'NOT_CONFIGURED';
  return err;
}

function call(method, path, body) {
  return config().then(function (cfg) {
    if (!cfg.url || !cfg.key) throw notConfigured();
    return fetch(cfg.url + path, {
      method: method,
      headers: { 'Authorization': 'Bearer ' + cfg.key, 'X-API-Key': cfg.key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var json; try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }
        if (!res.ok) throw new Error('Hermes returned ' + res.status + (json.error ? ': ' + json.error : ''));
        return json;
      });
    });
  });
}

// The payload Hermes receives when a campaign is launched.
function payload(campaign, account) {
  return {
    source: 'adbuilder',
    campaignId: campaign.id,
    name: campaign.name,
    account: account ? { id: account.id, client: account.client, company: account.company, link: account.link } : null,
    campaign: campaign.data
  };
}

function launch(campaign, account) { return call('POST', LAUNCH_PATH, payload(campaign, account)); }

function pullAccounts() {
  return call('GET', ACCOUNTS_PATH).then(function (json) {
    var list = Array.isArray(json) ? json : (json.accounts || json.data || []);
    return list.map(function (a) {
      return {
        client: String(a.client || a.name || a.account_name || '').trim(),
        company: String(a.company || a.business || '').trim(),
        link: String(a.link || a.url || (a.id ? 'https://business.facebook.com/adsmanager/manage/campaigns?act=' + String(a.id).replace(/^act_/, '') : '')).trim()
      };
    }).filter(function (a) { return a.client; });
  });
}

module.exports = { config: config, launch: launch, pullAccounts: pullAccounts, payload: payload };
