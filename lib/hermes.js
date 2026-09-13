// Hermes agent integration: one place for how the app talks to Hermes.
//
// Configure at the bottom of the Ad Builder page (stored in the database) or with env vars
// HERMES_URL and HERMES_WEBHOOK_SECRET (env wins). The secret must equal WEBHOOK_SECRET in Hermes' .env. Optional env: HERMES_AUTH (bearer|x-api-key|both),
// HERMES_LAUNCH_PATH, HERMES_TEST_PATH, HERMES_TEST_METHOD, PUBLIC_BASE_URL.
//
// Launch sends ONE request:  {method} {url}{launchPath}
//   { prompt: "<plain-language brief>", campaign: {...structured data...}, assets: [{name, type, url}] }
// Test sends:                 {testMethod} {url}{testPath}   body (POST only): { prompt: "Connection test…" }

var docs = require('./docs');
var crypto = require('crypto');

var DEFAULTS = { url: '', key: '', secret: '', auth: 'hmac', launchPath: '', testPath: '', testMethod: 'POST', publicBaseUrl: '' };

function config() {
  return docs.get('settings', 'hermes').then(function (row) {
    var cfg = Object.assign({}, DEFAULTS, row || {});
    cfg.source = 'settings';
    if (process.env.HERMES_URL && (process.env.HERMES_API_KEY || process.env.HERMES_WEBHOOK_SECRET)) {
      cfg.url = process.env.HERMES_URL; cfg.key = process.env.HERMES_API_KEY || cfg.key; cfg.secret = process.env.HERMES_WEBHOOK_SECRET || cfg.secret; cfg.source = 'env';
    }
    if (process.env.HERMES_AUTH) cfg.auth = process.env.HERMES_AUTH;
    if (process.env.HERMES_LAUNCH_PATH) cfg.launchPath = process.env.HERMES_LAUNCH_PATH;
    if (process.env.HERMES_TEST_PATH) cfg.testPath = process.env.HERMES_TEST_PATH;
    if (process.env.HERMES_TEST_METHOD) cfg.testMethod = process.env.HERMES_TEST_METHOD;
    if (process.env.PUBLIC_BASE_URL) cfg.publicBaseUrl = process.env.PUBLIC_BASE_URL;
    cfg.url = String(cfg.url || '').replace(/\/+$/, '');
    cfg.publicBaseUrl = String(cfg.publicBaseUrl || '').replace(/\/+$/, '');
    delete cfg.id; delete cfg.createdAt; delete cfg.updatedAt;
    return cfg;
  });
}

function credential(cfg) { return cfg.auth === 'hmac' ? cfg.secret : cfg.key; }
function notConfigured() {
  var err = new Error('Hermes is not connected yet. In the Hermes card at the bottom of Ad Builder, generate the WEBHOOK_SECRET, paste it into Hermes, and enter Hermes\' public webhook URL.');
  err.code = 'NOT_CONFIGURED';
  return err;
}

// How the secret travels. "hmac" signs the exact request body the Svix way, which is what Hermes'
// webhook receiver verifies:
//   svix-id          unique per delivery (Hermes keys idempotency and the dashboard session on it)
//   svix-timestamp   Unix seconds (must be within ~5 minutes of Hermes' clock)
//   svix-signature   v1,<base64 HMAC-SHA256 over "<svix-id>.<svix-timestamp>.<body>">
// The HMAC key is the secret with its "whsec_" prefix removed and the rest base64-decoded, exactly
// as the Svix libraries do. The body string is signed and sent as the same bytes.
// Svix verifiers accept several space-separated "v1,<sig>" values and pass if any matches. The
// first is the standard form (secret after whsec_, base64-decoded). The others cover receivers
// that key the HMAC with the raw secret text instead, so a mismatch in that detail cannot 401.
function svixKeys(secret) {
  var text = String(secret || '');
  var raw = text.replace(/^whsec_/, '');
  var keys = [Buffer.from(raw, 'base64')];
  keys.push(Buffer.from(raw, 'utf8'));
  keys.push(Buffer.from(text, 'utf8'));
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) keys.push(Buffer.from(raw, 'hex'));
  return keys;
}
function sign(secret, id, ts, body) {
  var seen = {};
  return svixKeys(secret).map(function (key) {
    return 'v1,' + crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + (body || '')).digest('base64');
  }).filter(function (sig) { if (seen[sig]) return false; seen[sig] = true; return true; }).join(' ');
}
function headers(cfg, raw, eventType, deliveryId) {
  var h = { 'Accept': 'application/json, text/plain, */*', 'User-Agent': 'AdsWarm/1.0', 'X-Source': 'adbuilder' };
  if (raw != null) h['Content-Type'] = 'application/json';
  if (eventType) h['X-Event-Type'] = eventType;
  var id = deliveryId || newDeliveryId();
  h['X-Request-ID'] = id;
  if (cfg.auth === 'bearer' || cfg.auth === 'both') h['Authorization'] = 'Bearer ' + cfg.key;
  if (cfg.auth === 'x-api-key' || cfg.auth === 'both') h['X-API-Key'] = cfg.key;
  if (cfg.auth === 'hmac') {
    var ts = String(Math.floor(Date.now() / 1000));
    h['svix-id'] = id;
    h['svix-timestamp'] = ts;
    h['svix-signature'] = sign(credential(cfg), id, ts, raw || '');
  }
  return h;
}
function newDeliveryId() { return 'msg_' + crypto.randomUUID().replace(/-/g, ''); }

// Returns { status, ok, body (parsed JSON or text), ms }. Rejects only when unreachable.
function call(cfg, method, path, body, eventType) {
  if (!cfg.url || !credential(cfg)) return Promise.reject(notConfigured());
  var started = Date.now();
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 30000);
  var raw = body ? JSON.stringify(body) : null;   // serialized exactly once: these bytes are signed and sent
  var deliveryId = newDeliveryId();
  var target = cfg.url + (path || '');
  return fetch(target, { method: method, headers: headers(cfg, raw, eventType, deliveryId), body: raw || undefined, signal: controller.signal })
    .then(function (res) {
      return res.text().then(function (text) {
        var parsed; try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
        if (!res.ok) console.error('Hermes delivery failed', { status: res.status, body: String(text || '').slice(0, 500), deliveryId: deliveryId, at: new Date().toISOString(), url: target.split('?')[0], bytes: raw ? Buffer.byteLength(raw) : 0 });
        return { status: res.status, ok: res.ok, body: parsed, ms: Date.now() - started, deliveryId: deliveryId };
      });
    })
    .catch(function (err) {
      console.error('Hermes unreachable', { deliveryId: deliveryId, at: new Date().toISOString(), url: target.split('?')[0], error: err.message });
      var e = new Error(err.name === 'AbortError' ? 'Hermes did not answer within 30 seconds.' : 'Could not reach Hermes: ' + err.message);
      e.code = 'UNREACHABLE';
      throw e;
    })
    .then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
}

function test() {
  return config().then(function (cfg) {
    var method = String(cfg.testMethod || 'GET').toUpperCase();
    var body = method === 'GET' || method === 'HEAD' ? null : { event: 'adbuilder.test', event_type: 'adbuilder.test', prompt: 'Connection test from AdsWarm. Reply with OK.', campaignId: 'test', source: 'adbuilder', test: true, sentAt: new Date().toISOString() };
    return call(cfg, method, cfg.testPath, body, 'adbuilder.test').then(function (r) { var why = explain(r); return Object.assign({ request: method + ' ' + cfg.url + cfg.testPath, signed: cfg.auth === 'hmac', warning: why || undefined }, r); });
  });
}

// ---- Turning a campaign into the payload Hermes receives ----
function absoluteUrl(baseUrl, creative) {
  if (creative.url && !creative.size) return creative.url;              // linked, not uploaded
  return baseUrl + '/api/creatives/' + creative.id;
}
function kind(c) { return /^video/.test(c.mime || '') ? 'video' : /^image/.test(c.mime || '') ? 'image' : 'file'; }
function lines(list) { return (list || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean); }
function targetingText(t) {
  if (!t) return [];
  var out = [];
  if (t.locations) out.push('Locations: ' + lines(String(t.locations).split('\n')).join('; '));
  out.push('Age: ' + (t.ageMin || 18) + '–' + (t.ageMax || 65) + (t.gender && t.gender !== 'all' ? ', Gender: ' + t.gender : ', Gender: all'));
  out.push('Targeting type: ' + (t.mode === 'detailed' ? 'Detailed targeting' : 'Advantage+ audience'));
  if (t.mode === 'detailed' && t.interests) out.push('Interests / behaviours / demographics: ' + lines(String(t.interests).split('\n')).join('; '));
  return out;
}
var GENERAL = { email: 'Email', full_name: 'Full name', phone: 'Phone number', first_name: 'First name', last_name: 'Last name', city: 'City', company: 'Company name', job_title: 'Job title' };

function buildPrompt(campaign, account, creatives) {
  var d = campaign.data || {};
  var byId = {}; creatives.forEach(function (c) { byId[c.id] = c; });
  var p = [];
  p.push('Build and launch this Meta Ads campaign exactly as specified. Ask before changing anything not listed.');
  p.push('');
  p.push('CAMPAIGN: ' + campaign.name);
  if (d.metaAdAccount && d.metaAdAccount.id) p.push('AD ACCOUNT: ' + d.metaAdAccount.name + ' (' + d.metaAdAccount.id + ')');
  else p.push('AD ACCOUNT: ' + (account ? account.client + (account.company ? ' (' + account.company + ')' : '') + (account.link ? ' — ' + account.link : '') : 'not set'));
  if (d.page && d.page.id) p.push('FACEBOOK PAGE: ' + d.page.name + ' (' + d.page.id + ')');
  p.push('DESTINATION: ' + (d.destination === 'leadform' ? 'Instant lead form (see LEAD FORM)' : 'Landing page — ' + (d.landingUrl || 'URL not set')));
  p.push('');
  p.push('AD COPY (primary text variants):');
  lines(d.copy).forEach(function (c, i) { p.push((i + 1) + '. ' + c); });
  p.push('');
  p.push('HEADLINES:');
  lines(d.headlines).forEach(function (c, i) { p.push((i + 1) + '. ' + c); });
  p.push('');
  p.push('CAMPAIGN TARGETING (default for ad sets):');
  targetingText(d.targeting).forEach(function (l) { p.push('- ' + l); });
  p.push('');
  p.push('CREATIVES (each one is an ad; download from the links):');
  (d.creativeIds || []).forEach(function (id, i) { var c = byId[id]; if (c) p.push((i + 1) + '. ' + c.name + ' [' + kind(c) + '] ' + c.publicUrl); });
  p.push('');
  p.push('AD SETS:');
  (d.adSets || []).forEach(function (s, i) {
    p.push((i + 1) + '. ' + (s.name || 'Ad set ' + (i + 1)));
    p.push('   Ads: ' + ((s.creativeIds || []).map(function (id) { return byId[id] ? byId[id].name : null; }).filter(Boolean).join(', ') || 'none'));
    if (s.useCampaignTargeting) p.push('   Targeting: same as campaign targeting');
    else targetingText(s.targeting).forEach(function (l) { p.push('   ' + l); });
  });
  if (d.destination === 'leadform' && d.leadForm) {
    var f = d.leadForm;
    p.push('');
    p.push('LEAD FORM:');
    p.push('- Greeting: ' + (f.greetingOn ? 'on — "' + (f.greetingHeadline || '') + '" / "' + (f.greetingDesc || '') + '"' : 'off'));
    if ((f.questions || []).length) {
      p.push('- Custom questions' + (f.logicOn ? ' (conditional logic ON)' : '') + ':');
      var qName = {}; f.questions.forEach(function (q, i) { qName[q.id] = 'Q' + (i + 1); });
      function target(v) { return v === 'general' ? 'Contact details' : v === 'end_qualified' ? 'End: qualified lead' : v === 'end_dq' ? 'End: disqualified' : v && qName[v] ? qName[v] : 'next question'; }
      f.questions.forEach(function (q, i) {
        p.push('  Q' + (i + 1) + ' (' + (q.type === 'multi' ? 'multiple choice' : 'short answer') + '): ' + (q.text || ''));
        if (q.type === 'multi') (q.options || []).forEach(function (o) { p.push('    - "' + (o.text || '') + '"' + (f.logicOn ? ' → ' + target(o.next) : '')); });
        else if (f.logicOn) p.push('    → ' + target(q.next));
      });
    }
    p.push('- Contact details: ' + ((f.general || []).map(function (g) { return GENERAL[g] || g; }).join(', ') || 'none'));
    p.push('- Privacy policy: ' + (f.privacyUrl || 'not set') + (f.privacyDesc ? ' — ' + f.privacyDesc : ''));
    var t = f.thanks || {};
    p.push('- Thank you page: "' + (t.headline || '') + '" / "' + (t.desc || '') + '"' + (t.ctaLabel || t.ctaLink ? ' — CTA "' + (t.ctaLabel || '') + '" → ' + (t.ctaLink || '') : ''));
  }
  if (d.destination === 'landing' && d.landingPage) {
    var lp = d.landingPage;
    p.push('');
    p.push('LANDING PAGE / CONVERSION:');
    p.push('- Pixel / dataset: ' + (lp.pixelId ? (lp.pixelName ? lp.pixelName + ' (' + lp.pixelId + ')' : lp.pixelId) : 'not set'));
    p.push('- Conversion objective: ' + (lp.objective || 'leads'));
    p.push('- Conversion event: ' + (lp.event === 'Custom' ? 'Custom — ' + (lp.customEvent || '') : lp.event || 'Lead'));
  }
  return p.join('\n');
}

function payload(campaign, account, creatives, baseUrl) {
  var used = creatives.filter(function (c) { return (campaign.data.creativeIds || []).indexOf(c.id) !== -1; })
    .map(function (c) { return Object.assign({}, c, { publicUrl: absoluteUrl(baseUrl, c) }); });
  return {
    event: 'adbuilder.campaign.launch',
    event_type: 'adbuilder.campaign.launch',
    source: 'adbuilder',
    sentAt: new Date().toISOString(),
    campaignId: campaign.id,
    name: campaign.name,
    prompt: buildPrompt(campaign, account, used),
    account: account ? { id: account.id, client: account.client, company: account.company, link: account.link } : null,
    assets: used.map(function (c) { return { id: c.id, name: c.name, type: kind(c), mime: c.mime || '', url: c.publicUrl }; }),
    campaign: campaign.data
  };
}

function launch(campaign, account, creatives, baseUrl) {
  return config().then(function (cfg) {
    var body = payload(campaign, account, creatives, cfg.publicBaseUrl || baseUrl);
    return call(cfg, 'POST', cfg.launchPath, body, 'adbuilder.campaign.launch').then(function (r) {
      var why = explain(r);
      if (why) { var e0 = new Error(why); e0.code = 'HERMES_ERROR'; e0.reply = r; throw e0; }
      if (!r.ok) { var e = new Error('Hermes ' + statusText(r) + (r.body && r.body.error ? ' (' + r.body.error + ')' : '')); e.code = 'HERMES_ERROR'; e.reply = r; throw e; }
      return r;
    });
  });
}

// Hermes answers 200 even when it did nothing ({ status: "ignored", reason: "event" | "filter" }
// or { status: "duplicate" }). Turn that into a plain-language error so the page can show it.
function explain(r) {
  if (r && typeof r.body === 'string' && /<!doctype html|<html/i.test(r.body)) {
    return 'That address answered with a web page (' + (/<title>([^<]*)<\/title>/i.exec(r.body) || [, 'HTML'])[1].trim() + '), not the webhook listener. The public address must map to Hermes\' webhook port (8644); the dashboard is on a different port.';
  }
  var b = r && r.body && typeof r.body === 'object' ? r.body : null;
  if (!b) return null;
  if (b.status === 'ignored') {
    if (b.reason === 'event') return 'Hermes ignored the event: the route\'s "events" list does not include it. Delete the events line from the adbuilder route in config.yaml and restart the gateway.';
    if (b.reason === 'filter') return 'Hermes ignored the request because of the route\'s "filters" setting.';
    return 'Hermes ignored the request (' + (b.reason || 'no reason given') + ').';
  }
  if (b.status === 'duplicate') return 'Hermes treated this as a duplicate delivery and did not run it again.';
  return null;
}
function statusText(r) {
  if (!r) return '';
  if (r.status === 202 || r.status === 200) return 'accepted';
  if (r.status === 401) return 'rejected the signature: the WEBHOOK_SECRET here and in Hermes\' .env must be the same value.';
  if (r.status === 404) return 'no such route: the URL must end in /webhooks/adbuilder.';
  if (r.status === 413) return 'payload too large.';
  if (r.status === 429) return 'rate limit hit, try again in a minute.';
  return 'returned HTTP ' + r.status;
}
// Any other one-off webhook to Hermes (same route as Launch): returns { status, ok, body, ms, ignored? }.
function send(cfg, body, eventType) {
  return call(cfg, 'POST', cfg.launchPath, body, eventType).then(function (r) {
    var why = explain(r);
    if (why) { r.ok = false; r.ignored = why; }
    return r;
  });
}

// Optional pull of the Meta catalog from Hermes: GET {url}{HERMES_META_PATH|/meta} -> { adAccounts, pixels, pages }
function pullMeta() {
  return config().then(function (cfg) {
    return call(cfg, 'GET', process.env.HERMES_META_PATH || '/meta').then(function (r) {
      if (!r.ok) throw new Error('Hermes returned ' + r.status);
      return r.body && typeof r.body === 'object' ? r.body : {};
    });
  });
}

function pullAccounts() {
  return config().then(function (cfg) {
    return call(cfg, 'GET', process.env.HERMES_ACCOUNTS_PATH || '/ad-accounts').then(function (r) {
      if (!r.ok) throw new Error('Hermes returned ' + r.status);
      var json = r.body;
      var list = Array.isArray(json) ? json : (json && (json.accounts || json.data)) || [];
      return list.map(function (a) {
        return {
          client: String(a.client || a.name || a.account_name || '').trim(),
          company: String(a.company || a.business || '').trim(),
          link: String(a.link || a.url || (a.id ? 'https://business.facebook.com/adsmanager/manage/campaigns?act=' + String(a.id).replace(/^act_/, '') : '')).trim()
        };
      }).filter(function (a) { return a.client; });
    });
  });
}

module.exports = { config: config, test: test, launch: launch, send: send, explain: explain, statusText: statusText, sign: sign, pullAccounts: pullAccounts, pullMeta: pullMeta, payload: payload, buildPrompt: buildPrompt, DEFAULTS: DEFAULTS };
