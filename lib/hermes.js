// Hermes agent integration: one place for how the app talks to Hermes.
//
// Configure at the bottom of the Ad Builder page (stored in the database) or with env vars
// HERMES_URL and HERMES_API_KEY (env wins). Optional env: HERMES_AUTH (bearer|x-api-key|both),
// HERMES_LAUNCH_PATH, HERMES_TEST_PATH, HERMES_TEST_METHOD, PUBLIC_BASE_URL.
//
// Launch sends ONE request:  {method} {url}{launchPath}
//   { prompt: "<plain-language brief>", campaign: {...structured data...}, assets: [{name, type, url}] }
// Test sends:                 {testMethod} {url}{testPath}   body (POST only): { prompt: "Connection test…" }

var docs = require('./docs');

var DEFAULTS = { url: '', key: '', auth: 'bearer', launchPath: '/campaigns', testPath: '/health', testMethod: 'GET', publicBaseUrl: '' };

function config() {
  return docs.get('settings', 'hermes').then(function (row) {
    var cfg = Object.assign({}, DEFAULTS, row || {});
    cfg.source = 'settings';
    if (process.env.HERMES_URL && process.env.HERMES_API_KEY) {
      cfg.url = process.env.HERMES_URL; cfg.key = process.env.HERMES_API_KEY; cfg.source = 'env';
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

function notConfigured() {
  var err = new Error('Hermes is not connected yet. Add the Hermes URL and API key in the Hermes section at the bottom of Ad Builder.');
  err.code = 'NOT_CONFIGURED';
  return err;
}

function headers(cfg, hasBody) {
  var h = { 'Accept': 'application/json, text/plain, */*' };
  if (hasBody) h['Content-Type'] = 'application/json';
  if (cfg.auth === 'bearer' || cfg.auth === 'both') h['Authorization'] = 'Bearer ' + cfg.key;
  if (cfg.auth === 'x-api-key' || cfg.auth === 'both') h['X-API-Key'] = cfg.key;
  return h;
}

// Returns { status, ok, body (parsed JSON or text), ms }. Rejects only when unreachable.
function call(cfg, method, path, body) {
  if (!cfg.url || !cfg.key) return Promise.reject(notConfigured());
  var started = Date.now();
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 30000);
  return fetch(cfg.url + (path || ''), { method: method, headers: headers(cfg, !!body), body: body ? JSON.stringify(body) : undefined, signal: controller.signal })
    .then(function (res) {
      return res.text().then(function (text) {
        var parsed; try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
        return { status: res.status, ok: res.ok, body: parsed, ms: Date.now() - started };
      });
    })
    .catch(function (err) {
      var e = new Error(err.name === 'AbortError' ? 'Hermes did not answer within 30 seconds.' : 'Could not reach Hermes: ' + err.message);
      e.code = 'UNREACHABLE';
      throw e;
    })
    .then(function (r) { clearTimeout(timer); return r; }, function (e) { clearTimeout(timer); throw e; });
}

function test() {
  return config().then(function (cfg) {
    var method = String(cfg.testMethod || 'GET').toUpperCase();
    var body = method === 'GET' || method === 'HEAD' ? null : { prompt: 'Connection test from AdBuilder. Reply with OK.', source: 'adbuilder', test: true };
    return call(cfg, method, cfg.testPath, body).then(function (r) { return Object.assign({ request: method + ' ' + cfg.url + cfg.testPath }, r); });
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
  p.push('AD ACCOUNT: ' + (account ? account.client + (account.company ? ' (' + account.company + ')' : '') + (account.link ? ' — ' + account.link : '') : 'not set'));
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
    p.push('- Pixel ID: ' + (lp.pixelId || 'not set'));
    p.push('- Conversion objective: ' + (lp.objective || 'leads'));
    p.push('- Conversion event: ' + (lp.event === 'Custom' ? 'Custom — ' + (lp.customEvent || '') : lp.event || 'Lead'));
  }
  return p.join('\n');
}

function payload(campaign, account, creatives, baseUrl) {
  var used = creatives.filter(function (c) { return (campaign.data.creativeIds || []).indexOf(c.id) !== -1; })
    .map(function (c) { return Object.assign({}, c, { publicUrl: absoluteUrl(baseUrl, c) }); });
  return {
    source: 'adbuilder',
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
    return call(cfg, 'POST', cfg.launchPath, body).then(function (r) {
      if (!r.ok) { var e = new Error('Hermes returned ' + r.status + (r.body && r.body.error ? ': ' + r.body.error : '')); e.code = 'HERMES_ERROR'; e.reply = r; throw e; }
      return r;
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

module.exports = { config: config, test: test, launch: launch, pullAccounts: pullAccounts, payload: payload, buildPrompt: buildPrompt, DEFAULTS: DEFAULTS };
