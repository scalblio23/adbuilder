// AI brain for the Ad Builder, using an OpenAI API key (platform.openai.com).
// Settings live in the "settings/ai" document: { apiKey, model }. The key never leaves the server.

var docs = require('./docs');

var API_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
var DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

function load() {
  return docs.get('settings', 'ai').then(function (row) {
    var cfg = Object.assign({ apiKey: '', model: '' }, row || {});
    if (process.env.OPENAI_API_KEY) { cfg.apiKey = process.env.OPENAI_API_KEY; cfg.source = 'env'; }
    return cfg;
  });
}
function save(cfg) { var c = { apiKey: cfg.apiKey || '', model: cfg.model || '' }; return docs.put('settings', 'ai', c); }
function publicView(cfg) {
  return { model: cfg.model || DEFAULT_MODEL, defaultModel: DEFAULT_MODEL, apiKeyMasked: cfg.apiKey ? '••••' + cfg.apiKey.slice(-4) : '', ready: !!cfg.apiKey, source: cfg.source || 'settings' };
}

function extractText(response) {
  var out = '';
  (response.output || []).forEach(function (item) { (item.content || []).forEach(function (c) { if (c.type === 'output_text' && c.text) out += c.text; }); });
  return out || response.output_text || '';
}

// opts: { system, prompt, maxTokens }
function complete(opts) {
  return load().then(function (cfg) {
    if (!cfg.apiKey) { var e = new Error('No OpenAI API key saved. Add one under AI settings at the bottom of Ad Builder.'); e.code = 'NOT_CONFIGURED'; throw e; }
    var body = { model: cfg.model || DEFAULT_MODEL, instructions: opts.system || '', input: [{ role: 'user', content: [{ type: 'input_text', text: opts.prompt }] }], store: false };
    if (opts.maxTokens) body.max_output_tokens = opts.maxTokens;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 90000);
    return fetch(API_BASE + '/v1/responses', { method: 'POST', headers: { 'Authorization': 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      .then(function (res) {
        return res.text().then(function (t) {
          var j; try { j = JSON.parse(t); } catch (e2) { j = null; }
          if (!res.ok) throw new Error('OpenAI returned ' + res.status + ': ' + ((j && j.error && j.error.message) || t.slice(0, 300)));
          return extractText(j || {});
        });
      })
      .catch(function (err) { if (err.name === 'AbortError') throw new Error('OpenAI did not answer within 90 seconds.'); throw err; })
      .then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
  });
}
function parseJson(text) {
  var m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('The model did not return JSON. Try again.');
  return JSON.parse(m[0]);
}

// ---- Campaign generation ----
var SYSTEM = 'You are a senior Meta Ads strategist. Write tight, specific, compliant ad copy in the advertiser\'s voice. Reply with JSON only: no prose, no markdown fences.';
function buildCampaign(brief, campaign, catalog) {
  var d = campaign.data || {};
  var prompt = [
    'Brief from the advertiser:', brief, '',
    'Existing campaign name: ' + (campaign.name || 'untitled'),
    'Destination: ' + (d.destination === 'leadform' ? 'instant lead form' : 'landing page'),
    d.landingUrl ? 'Landing page: ' + d.landingUrl : '',
    catalog && catalog.pages && catalog.pages.length ? 'Facebook pages available: ' + catalog.pages.map(function (p) { return p.name; }).join(', ') : '',
    '',
    'Return JSON with exactly these keys:',
    '{ "campaignName": string,',
    '  "copy": [3 to 5 primary text variants, each 40-125 words, different angles],',
    '  "headlines": [5 headlines under 40 characters],',
    '  "targeting": { "locations": string (one per line), "ageMin": number, "ageMax": number, "gender": "all"|"men"|"women", "mode": "advantage"|"detailed", "interests": string (one per line) },',
    '  "leadForm": { "greetingHeadline": string, "greetingDesc": string, "questions": [ { "type": "multi"|"short", "text": string, "options": [string] } ], "thanksHeadline": string, "thanksDesc": string },',
    '  "adSetNames": [2 to 3 short ad set names describing audiences] }'
  ].filter(function (l) { return l !== ''; }).join('\n');
  return complete({ system: SYSTEM, prompt: prompt, maxTokens: 4000 }).then(parseJson);
}
function generateList(kind, brief, campaign) {
  var d = campaign.data || {};
  var ask = kind === 'headlines' ? '5 headlines under 40 characters' : '4 primary text variants, each 40-125 words, different angles';
  var prompt = 'Brief: ' + brief + '\nCampaign: ' + campaign.name + '\nExisting copy: ' + JSON.stringify((d.copy || []).filter(Boolean)) + '\nExisting headlines: ' + JSON.stringify((d.headlines || []).filter(Boolean)) + '\n\nWrite ' + ask + '. Return JSON: { "items": [string] }';
  return complete({ system: SYSTEM, prompt: prompt, maxTokens: 2000 }).then(parseJson).then(function (j) { return (j.items || []).map(String).filter(Boolean); });
}
function test() {
  return complete({ system: 'Reply with the single word OK.', prompt: 'Connection test from AdBuilder.', maxTokens: 20 }).then(function (t) { return { ok: true, reply: String(t).trim().slice(0, 200) }; });
}

module.exports = { load: load, save: save, publicView: publicView, complete: complete, buildCampaign: buildCampaign, generateList: generateList, test: test, DEFAULT_MODEL: DEFAULT_MODEL };
