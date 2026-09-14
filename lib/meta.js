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
// "Results" is an Ads Manager concept: which conversion counts depends on what the ad sets are
// optimised for (their optimization_goal and, for website conversions, the promoted event such as
// SCHEDULE or LEAD). Every daily row also carries the standard conversions it saw ("conv"), so the
// dashboard can switch a campaign to another result type without pulling again.
var EVENTS = ['lead', 'schedule', 'purchase', 'contact', 'complete_registration', 'submit_application', 'start_trial', 'subscribe', 'add_to_cart', 'initiate_checkout', 'add_payment_info', 'search', 'view_content', 'find_location', 'customize_product', 'donate'];
var LABELS = { lead: 'Leads', schedule: 'Website schedules', purchase: 'Purchases', contact: 'Contacts', complete_registration: 'Registrations', submit_application: 'Applications', start_trial: 'Trials', subscribe: 'Subscriptions', add_to_cart: 'Adds to cart', initiate_checkout: 'Checkouts', add_payment_info: 'Payment info', search: 'Searches', view_content: 'Content views', find_location: 'Location finds', customize_product: 'Customisations', donate: 'Donations', link_click: 'Link clicks', landing_page_view: 'Landing page views', messaging: 'Conversations', thruplay: 'ThruPlays', app_install: 'App installs', post_engagement: 'Engagements', reach: 'Reach', impressions: 'Impressions' };
// Meta names the same standard event several ways depending on age and source: "lead",
// "offsite_conversion.fb_pixel_lead", "omni_lead", and for the newer events "schedule_total",
// "schedule_website", "schedule_mobile_app", "schedule_offline". Match all of them.
function variants(ev) { return [ev, 'omni_' + ev, ev + '_total', ev + '_website', ev + '_mobile_app', ev + '_offline', 'offsite_conversion.fb_pixel_' + ev, 'onsite_conversion.' + ev, 'onsite_conversion.' + ev + '_grouped', 'offsite_conversion.custom.' + ev]; }
var SPECIAL = {
  lead: ['lead', 'lead_total', 'lead_website', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.messaging_conversation_started_7d'],
  purchase: ['purchase', 'purchase_total', 'purchase_website', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'],
  link_click: ['link_click'], landing_page_view: ['landing_page_view', 'omni_landing_page_view'],
  messaging: ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'],
  thruplay: ['video_thruplay_watched_actions', 'video_view'], app_install: ['mobile_app_install', 'omni_app_install', 'app_install'],
  post_engagement: ['post_engagement', 'page_engagement']
};
function namesFor(key) {
  if (/^custom_\d+$/.test(key)) return ['offsite_conversion.custom.' + key.slice(7)];
  return SPECIAL[key] || variants(key);
}
var CALL_ACTIONS = ['click_to_call_call_confirm', 'onsite_conversion.click_to_call_call_confirm', 'call_confirm_grouped'];
// Meta reports one conversion under several action types; take the largest of the group, not the sum.
function actionMax(list, names) {
  var best = 0;
  (list || []).forEach(function (a) { if (names.indexOf(a.action_type) !== -1) best = Math.max(best, Number(a.value) || 0); });
  return best;
}
// What the ad sets optimise for -> the result key. Website conversions use the promoted event.
function resultKeyFromAdSets(adsets, objective) {
  var votes = {};
  (adsets || []).forEach(function (as) {
    var goal = String(as.optimization_goal || '').toUpperCase();
    var po = as.promoted_object || {};
    var ev = po.custom_event_type ? String(po.custom_event_type).toLowerCase() : '';
    var key = null;
    if (goal === 'OFFSITE_CONVERSIONS' || goal === 'CONVERSIONS' || goal === 'VALUE') key = po.custom_conversion_id ? 'custom_' + po.custom_conversion_id : ev && ev !== 'other' ? ev : 'purchase';
    else if (goal === 'LEAD_GENERATION' || goal === 'QUALITY_LEAD') key = 'lead';
    else if (goal === 'LINK_CLICKS') key = 'link_click';
    else if (goal === 'LANDING_PAGE_VIEWS') key = 'landing_page_view';
    else if (goal === 'CONVERSATIONS' || goal === 'REPLIES') key = 'messaging';
    else if (goal === 'THRUPLAY' || goal === 'VIDEO_VIEWS') key = 'thruplay';
    else if (goal === 'APP_INSTALLS') key = 'app_install';
    else if (goal === 'POST_ENGAGEMENT' || goal === 'PAGE_LIKES') key = 'post_engagement';
    else if (goal === 'REACH') key = 'reach';
    else if (goal === 'IMPRESSIONS' || goal === 'AD_RECALL_LIFT') key = 'impressions';
    if (key) votes[key] = (votes[key] || 0) + 1;
  });
  var best = Object.keys(votes).sort(function (a, b) { return votes[b] - votes[a]; })[0];
  if (best) return best;
  var o = String(objective || '').toUpperCase();
  if (/LEAD/.test(o)) return 'lead';
  if (/SALES|CONVERSION/.test(o)) return 'purchase';
  if (/TRAFFIC|LINK_CLICK/.test(o)) return 'link_click';
  if (/ENGAGEMENT/.test(o)) return 'post_engagement';
  if (/MESSAGE/.test(o)) return 'messaging';
  if (/AWARENESS|REACH/.test(o)) return 'reach';
  if (/VIDEO/.test(o)) return 'thruplay';
  if (/APP/.test(o)) return 'app_install';
  return 'lead';
}
function labelFor(key, extra) { return (extra && extra[key]) || LABELS[key] || (key ? key.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }) : 'Results'); }
function resultValue(row, key) {
  if (key === 'reach') return Number(row.reach) || 0;
  if (key === 'impressions') return Number(row.impressions) || 0;
  return actionMax(allActions(row), namesFor(key));
}
function listValue(list) { var best = 0; (list || []).forEach(function (a) { best = Math.max(best, Number(a.value) || 0); }); return best; }
// Meta splits conversions over two fields: "actions" (leads, purchases, link clicks, …) and
// "conversions" (the newer standard events: schedule_website, contact_total, …). Read both as one list.
function allActions(row) { return (row.actions || []).concat(row.conversions || []); }
function dayRow(row, key) {
  var acts = allActions(row);
  var conv = {};
  EVENTS.concat(['link_click', 'landing_page_view', 'messaging', 'thruplay', 'app_install', 'post_engagement']).forEach(function (k) { var v = actionMax(acts, namesFor(k)); if (v) conv[k] = v; });
  acts.forEach(function (a) { var m = /^offsite_conversion\.custom\.(\d+)$/.exec(a.action_type || ''); if (m && Number(a.value)) conv['custom_' + m[1]] = Math.max(conv['custom_' + m[1]] || 0, Number(a.value)); });
  var raw = {}; acts.forEach(function (a) { if (Number(a.value)) raw[String(a.action_type).slice(0, 60)] = Number(a.value); });
  var out = {
    date: row.date_start,
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    clicksAll: Number(row.clicks) || 0,
    linkClicks: Number(row.inline_link_clicks) || 0,
    uniqueClicks: Number(row.unique_clicks) || 0,
    uniqueLinkClicks: Number(row.unique_inline_link_clicks) || 0,
    outboundClicks: listValue(row.outbound_clicks),
    landingPageViews: conv.landing_page_view || 0,
    results: resultValue(row, key),
    leads: conv.lead || 0,
    purchases: conv.purchase || 0,
    revenue: actionMax((row.action_values || []).concat(row.conversion_values || []), SPECIAL.purchase),
    calls: actionMax(acts, CALL_ACTIONS),
    postEngagement: actionMax(acts, ['post_engagement']),
    pageEngagement: actionMax(acts, ['page_engagement']),
    reactions: actionMax(acts, ['post_reaction']),
    comments: actionMax(acts, ['comment']),
    shares: actionMax(acts, ['post']),
    saves: actionMax(acts, ['onsite_conversion.post_save']),
    pageLikes: actionMax(acts, ['like']),
    videoPlays: listValue(row.video_play_actions),
    videoViews3s: actionMax(acts, ['video_view']),
    thruplays: listValue(row.video_thruplay_watched_actions),
    videoP25: listValue(row.video_p25_watched_actions),
    videoP50: listValue(row.video_p50_watched_actions),
    videoP75: listValue(row.video_p75_watched_actions),
    videoP100: listValue(row.video_p100_watched_actions),
    messaging: conv.messaging || 0,
    socialSpend: Number(row.social_spend) || 0,
    conv: conv,
    actions: raw
  };
  Object.keys(out).forEach(function (k) { if (out[k] === 0 && k !== 'spend' && k !== 'impressions' && k !== 'results') delete out[k]; });
  return out;
}
var INSIGHT_FIELDS = 'date_start,spend,impressions,reach,clicks,inline_link_clicks,unique_clicks,unique_inline_link_clicks,outbound_clicks,actions,action_values,conversions,conversion_values,video_play_actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,social_spend,account_currency,objective';

// Where an ad sends people: the link in its story spec (image, video, carousel) or its asset feed.
function destinationOf(creative) {
  if (!creative) return '';
  var spec = creative.object_story_spec || {};
  var cands = [];
  if (spec.link_data) { cands.push(spec.link_data.link); (spec.link_data.child_attachments || []).forEach(function (c) { cands.push(c.link); }); if (spec.link_data.call_to_action && spec.link_data.call_to_action.value) cands.push(spec.link_data.call_to_action.value.link); }
  if (spec.video_data && spec.video_data.call_to_action && spec.video_data.call_to_action.value) cands.push(spec.video_data.call_to_action.value.link);
  if (spec.template_data) cands.push(spec.template_data.link);
  var feed = creative.asset_feed_spec || {};
  (feed.link_urls || []).forEach(function (l) { cands.push(l.website_url || l.display_url); });
  if (feed.call_to_actions) feed.call_to_actions.forEach(function (c) { if (c.value) cands.push(c.value.link); });
  cands.push(creative.link_url);
  var hit = cands.filter(function (u) { return typeof u === 'string' && /^https?:\/\//i.test(u); })[0] || '';
  return hit.slice(0, 1000);
}
// One tracked campaign -> the item shape PUT /api/v1/campaign-stats accepts (campaign daily + ads with daily).
function campaignStats(token, campaign, since, until) {
  var objective = campaign.objective || '', key = 'lead';
  var item = { campaignId: campaign.id, name: campaign.name, status: campaign.status, currency: '', daily: [], ads: [] };
  return graph(token, '/' + campaign.id, { fields: 'id,name,status,effective_status,objective' }).then(function (c) {
    objective = c.objective || objective;
    item.name = c.name || item.name; item.status = c.effective_status || c.status || item.status; item.objective = objective;
    return pause(CALL_GAP_MS);
  }).then(function () {
    return graphAll(token, '/' + campaign.id + '/adsets', { fields: 'id,name,optimization_goal,promoted_object' });
  }).then(function (adsets) {
    key = resultKeyFromAdSets(adsets, objective);
    item.resultKey = key;
    item.optimisation = adsets.map(function (a) { var po = a.promoted_object || {}; return { id: a.id, name: a.name, goal: a.optimization_goal || '', event: po.custom_event_type || '', customConversionId: po.custom_conversion_id || '' }; }).slice(0, 50);
    var ids = {}; item.optimisation.forEach(function (o) { if (o.customConversionId) ids[o.customConversionId] = true; });
    item.convLabels = {};
    return Object.keys(ids).reduce(function (chain, id) {
      return chain.then(function () { return pause(CALL_GAP_MS); }).then(function () {
        return graph(token, '/' + id, { fields: 'id,name,custom_event_type' }).then(function (cc) { item.convLabels['custom_' + id] = cc.name || ('Custom conversion ' + id); }, function () { item.convLabels['custom_' + id] = 'Custom conversion ' + id; });
      });
    }, Promise.resolve()).then(function () { item.resultType = labelFor(key, item.convLabels); return pause(CALL_GAP_MS); });
  }).then(function () {
    return graphAll(token, '/' + campaign.id + '/insights', { fields: INSIGHT_FIELDS, time_increment: 1, time_range: { since: since, until: until }, limit: 100 });
  }).then(function (rows) {
    item.currency = rows[0] && rows[0].account_currency || '';
    item.daily = rows.map(function (r) { return dayRow(r, key); });
    return pause(CALL_GAP_MS);
  }).then(function () {
    return graphAll(token, '/' + campaign.id + '/ads', { fields: 'id,name,effective_status,status,adset{id,name},creative{thumbnail_url,image_url,object_story_spec,asset_feed_spec},preview_shareable_link' });
  }).then(function (ads) {
    var byId = {};
    ads.forEach(function (a) {
      byId[a.id] = { id: a.id, name: a.name || 'Ad ' + a.id, status: a.effective_status || a.status || '', adSetId: a.adset && a.adset.id || '', adSetName: a.adset && a.adset.name || '', thumbnailUrl: a.creative && a.creative.thumbnail_url || '', imageUrl: a.creative && a.creative.image_url || '', linkUrl: destinationOf(a.creative), previewUrl: a.preview_shareable_link || '', daily: [] };
    });
    return pause(CALL_GAP_MS).then(function () {
      return graphAll(token, '/' + campaign.id + '/insights', { level: 'ad', fields: 'ad_id,ad_name,adset_id,adset_name,' + INSIGHT_FIELDS, time_increment: 1, time_range: { since: since, until: until }, limit: 500 });
    }).then(function (rows) {
      rows.forEach(function (r) {
        var ad = byId[r.ad_id];
        if (!ad) { ad = byId[r.ad_id] = { id: r.ad_id, name: r.ad_name || 'Ad ' + r.ad_id, status: '', adSetId: r.adset_id || '', adSetName: r.adset_name || '', thumbnailUrl: '', previewUrl: '', daily: [] }; }
        ad.daily.push(dayRow(r, key));
      });
      item.ads = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (a) { return a.daily.length || a.status === 'ACTIVE'; });
      return item;
    });
  });
}

module.exports = { config: config, notConfigured: notConfigured, whoAmI: whoAmI, adAccounts: adAccounts, campaigns: campaigns, campaignStats: campaignStats, pause: pause, LABELS: LABELS, labelFor: labelFor };
