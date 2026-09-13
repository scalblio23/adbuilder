// Direct Meta Marketing API access for the Campaigns tab (no agent in the loop).
//
// The access token is stored server-side in the settings document "meta" (pasted in the Campaigns
// tab) or given as META_ACCESS_TOKEN. With it the app lists ad accounts and campaigns and pulls
// daily insights, campaign level and ad level, for the tracked campaigns.

var docs = require('./docs');

var GRAPH = process.env.META_GRAPH_URL || 'https://graph.facebook.com/v21.0';
var PAGE_LIMIT = 200;
var MAX_PAGES = 25;
var CALL_GAP_MS = 150;   // small pause between calls to stay well inside Meta's rate limits

function config() {
  return docs.get('settings', 'meta').then(function (row) {
    var env = process.env.META_ACCESS_TOKEN || '';
    var token = env || (row && row.token) || '';
    return {
      token: token, set: !!token, source: env ? 'env' : 'settings',
      masked: token ? token.slice(0, 4) + '…' + token.slice(-6) : '',
      user: (row && row.user) || '', checkedAt: (row && row.checkedAt) || null, accounts: (row && row.accounts) || null, error: (row && row.error) || ''
    };
  });
}
function notConfigured() {
  var e = new Error('No Meta access token. Paste one in the Campaigns tab under "Meta connection" (or set META_ACCESS_TOKEN).');
  e.code = 'NOT_CONFIGURED';
  return e;
}
function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function fail(json, status) {
  var msg = json && json.error ? (json.error.message || json.error.type) + (json.error.code != null ? ' (code ' + json.error.code + ')' : '') : 'HTTP ' + status;
  var err = new Error('Meta API: ' + msg);
  var code = json && json.error && json.error.code;
  err.code = code === 190 || code === 102 || code === 10 || code === 200 ? 'META_AUTH' : code === 4 || code === 17 || code === 32 || code === 613 ? 'META_RATE' : 'META_ERROR';
  err.status = status;
  return err;
}
function fetchJson(url) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 25000);
  return fetch(url, { signal: controller.signal }).then(function (res) {
    return res.text().then(function (text) {
      clearTimeout(timer);
      var json; try { json = JSON.parse(text); } catch (e) { json = null; }
      if (!res.ok || !json || json.error) throw fail(json, res.status);
      return json;
    });
  }, function (err) {
    clearTimeout(timer);
    var e = new Error(err.name === 'AbortError' ? 'Meta API did not answer within 25 seconds.' : 'Could not reach the Meta API: ' + err.message);
    e.code = 'META_UNREACHABLE';
    throw e;
  });
}
function graph(token, path, params) {
  var url = new URL(GRAPH + path);
  Object.keys(params || {}).forEach(function (k) { if (params[k] != null) url.searchParams.set(k, typeof params[k] === 'object' ? JSON.stringify(params[k]) : String(params[k])); });
  url.searchParams.set('access_token', token);
  return fetchJson(url.toString());
}
// Follows paging.next until done (or MAX_PAGES).
function graphAll(token, path, params) {
  var out = [], pages = 0;
  function more(json) {
    out = out.concat(json.data || []);
    pages++;
    if (json.paging && json.paging.next && pages < MAX_PAGES) return pause(CALL_GAP_MS).then(function () { return fetchJson(json.paging.next); }).then(more);
    return out;
  }
  return graph(token, path, Object.assign({ limit: PAGE_LIMIT }, params || {})).then(more);
}

function whoAmI(token) { return graph(token, '/me', { fields: 'id,name' }); }

function adAccounts(token) {
  return graphAll(token, '/me/adaccounts', { fields: 'id,name,currency,account_status' }).then(function (list) {
    return list.map(function (a) { return { id: a.id, name: a.name || a.id, currency: a.currency || '', status: a.account_status != null ? String(a.account_status) : '' }; });
  });
}
function campaigns(token, accounts) {
  var out = [];
  return accounts.reduce(function (chain, acct) {
    return chain.then(function () {
      return graphAll(token, '/' + acct.id + '/campaigns', { fields: 'id,name,status,effective_status,objective,updated_time' }).then(function (list) {
        list.forEach(function (c) { out.push({ id: c.id, name: c.name, adAccountId: acct.id, adAccountName: acct.name || '', status: c.effective_status || c.status || '', objective: c.objective || '' }); });
        return pause(CALL_GAP_MS);
      });
    });
  }, Promise.resolve()).then(function () { return out; });
}

// ---- Insights ----
// "Results" is a Meta Ads Manager concept: which action counts depends on the campaign objective.
var RESULT_BY_OBJECTIVE = {
  OUTCOME_LEADS: { label: 'Leads', actions: ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_conversation_started_7d'] },
  LEAD_GENERATION: { label: 'Leads', actions: ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'] },
  OUTCOME_SALES: { label: 'Purchases', actions: ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'] },
  CONVERSIONS: { label: 'Purchases', actions: ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'lead', 'offsite_conversion.fb_pixel_lead'] },
  OUTCOME_TRAFFIC: { label: 'Link clicks', actions: ['link_click'] },
  LINK_CLICKS: { label: 'Link clicks', actions: ['link_click'] },
  OUTCOME_ENGAGEMENT: { label: 'Engagements', actions: ['post_engagement', 'onsite_conversion.messaging_conversation_started_7d'] },
  POST_ENGAGEMENT: { label: 'Engagements', actions: ['post_engagement'] },
  MESSAGES: { label: 'Conversations', actions: ['onsite_conversion.messaging_conversation_started_7d'] },
  OUTCOME_AWARENESS: { label: 'Reach', reach: true },
  BRAND_AWARENESS: { label: 'Reach', reach: true },
  REACH: { label: 'Reach', reach: true },
  VIDEO_VIEWS: { label: 'ThruPlays', actions: ['video_thruplay_watched_actions', 'video_view'] },
  OUTCOME_APP_PROMOTION: { label: 'App installs', actions: ['mobile_app_install', 'omni_app_install', 'app_install'] },
  APP_INSTALLS: { label: 'App installs', actions: ['mobile_app_install', 'omni_app_install', 'app_install'] }
};
var LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
var PURCHASE_ACTIONS = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'];
var CALL_ACTIONS = ['click_to_call_call_confirm', 'onsite_conversion.click_to_call_call_confirm', 'call_confirm_grouped'];
// Meta reports one conversion under several action types; take the largest of the group, not the sum.
function actionMax(list, names) {
  var best = 0;
  (list || []).forEach(function (a) { if (names.indexOf(a.action_type) !== -1) best = Math.max(best, Number(a.value) || 0); });
  return best;
}
function resultOf(objective, row) {
  var def = RESULT_BY_OBJECTIVE[String(objective || '').toUpperCase()];
  if (!def) return { label: 'Results', value: actionMax(row.actions, LEAD_ACTIONS) || actionMax(row.actions, PURCHASE_ACTIONS) || Number(row.inline_link_clicks) || 0 };
  if (def.reach) return { label: def.label, value: Number(row.reach) || 0 };
  return { label: def.label, value: actionMax(row.actions, def.actions) };
}
function dayRow(row, objective) {
  var res = resultOf(objective, row);
  return {
    date: row.date_start,
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    clicksAll: Number(row.clicks) || 0,
    linkClicks: Number(row.inline_link_clicks) || 0,
    results: res.value,
    leads: actionMax(row.actions, LEAD_ACTIONS),
    purchases: actionMax(row.actions, PURCHASE_ACTIONS),
    revenue: actionMax(row.action_values, PURCHASE_ACTIONS),
    calls: actionMax(row.actions, CALL_ACTIONS)
  };
}
var INSIGHT_FIELDS = 'date_start,spend,impressions,reach,clicks,inline_link_clicks,actions,action_values,account_currency,objective';

// One tracked campaign -> the item shape PUT /api/v1/campaign-stats accepts (campaign daily + ads with daily).
function campaignStats(token, campaign, since, until) {
  var objective = campaign.objective || '';
  var item = { campaignId: campaign.id, name: campaign.name, status: campaign.status, currency: '', daily: [], ads: [] };
  return graph(token, '/' + campaign.id, { fields: 'id,name,status,effective_status,objective' }).then(function (c) {
    objective = c.objective || objective;
    item.name = c.name || item.name; item.status = c.effective_status || c.status || item.status; item.objective = objective;
    item.resultType = (RESULT_BY_OBJECTIVE[String(objective).toUpperCase()] || { label: 'Results' }).label;
    return pause(CALL_GAP_MS);
  }).then(function () {
    return graphAll(token, '/' + campaign.id + '/insights', { fields: INSIGHT_FIELDS, time_increment: 1, time_range: { since: since, until: until }, limit: 100 });
  }).then(function (rows) {
    item.currency = rows[0] && rows[0].account_currency || '';
    item.daily = rows.map(function (r) { return dayRow(r, objective); });
    return pause(CALL_GAP_MS);
  }).then(function () {
    return graphAll(token, '/' + campaign.id + '/ads', { fields: 'id,name,effective_status,status,adset{id,name},creative{thumbnail_url},preview_shareable_link' });
  }).then(function (ads) {
    var byId = {};
    ads.forEach(function (a) {
      byId[a.id] = { id: a.id, name: a.name || 'Ad ' + a.id, status: a.effective_status || a.status || '', adSetId: a.adset && a.adset.id || '', adSetName: a.adset && a.adset.name || '', thumbnailUrl: a.creative && a.creative.thumbnail_url || '', previewUrl: a.preview_shareable_link || '', daily: [] };
    });
    return pause(CALL_GAP_MS).then(function () {
      return graphAll(token, '/' + campaign.id + '/insights', { level: 'ad', fields: 'ad_id,ad_name,adset_id,adset_name,' + INSIGHT_FIELDS, time_increment: 1, time_range: { since: since, until: until }, limit: 500 });
    }).then(function (rows) {
      rows.forEach(function (r) {
        var ad = byId[r.ad_id];
        if (!ad) { ad = byId[r.ad_id] = { id: r.ad_id, name: r.ad_name || 'Ad ' + r.ad_id, status: '', adSetId: r.adset_id || '', adSetName: r.adset_name || '', thumbnailUrl: '', previewUrl: '', daily: [] }; }
        ad.daily.push(dayRow(r, objective));
      });
      item.ads = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (a) { return a.daily.length || a.status === 'ACTIVE'; });
      return item;
    });
  });
}

module.exports = { config: config, notConfigured: notConfigured, whoAmI: whoAmI, adAccounts: adAccounts, campaigns: campaigns, campaignStats: campaignStats, pause: pause, RESULT_BY_OBJECTIVE: RESULT_BY_OBJECTIVE };
