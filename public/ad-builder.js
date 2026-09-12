// Ad Builder: a nine-step campaign form saved to the server as a campaign draft.
(function () {
  var root = document.getElementById('builder');
  if (!root) return;

  var API = '/api/campaigns';
  var GENERAL_QUESTIONS = [
    ['email', 'Email'], ['full_name', 'Full name'], ['phone', 'Phone number'], ['first_name', 'First name'],
    ['last_name', 'Last name'], ['city', 'City'], ['company', 'Company name'], ['job_title', 'Job title']
  ];
  var OBJECTIVES = [['leads', 'Leads'], ['sales', 'Sales'], ['traffic', 'Traffic'], ['engagement', 'Engagement'], ['app', 'App promotion'], ['awareness', 'Awareness']];
  var EVENTS = ['Lead', 'Purchase', 'CompleteRegistration', 'Contact', 'SubmitApplication', 'Schedule', 'Subscribe', 'AddToCart', 'InitiateCheckout', 'ViewContent', 'Custom'];

  var campaigns = [];      // [{id, name, status}]
  var camp = null;         // the loaded campaign {id, name, status, data}
  var accounts = [];       // ad accounts for step 5
  var library = [];        // creatives for step 6
  var meta = { adAccounts: { items: [], syncedAt: null }, pixels: { items: [], syncedAt: null }, pages: { items: [], syncedAt: null } };   // synced from Hermes
  var saveTimer = null;
  var saveState = null;    // element showing Saved / Saving

  // ---------- tiny DOM helpers ----------
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'value') node.value = attrs[k];
      else if (k === 'checked') node.checked = !!attrs[k];
      else if (k === 'disabled') node.disabled = !!attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function field(label, control, hint) {
    return h('div', { 'class': 'field' }, [h('label', { text: label }), control, hint ? h('span', { 'class': 'field__hint', text: hint }) : null]);
  }
  function text(value, placeholder, onInput, type) {
    return h('input', { 'class': 'table__input', type: type || 'text', value: value || '', placeholder: placeholder || '', oninput: function (e) { onInput(e.target.value); dirty(); } });
  }
  function area(value, placeholder, onInput, rows) {
    var t = h('textarea', { 'class': 'table__input', placeholder: placeholder || '', rows: String(rows || 3), oninput: function (e) { onInput(e.target.value); dirty(); } });
    t.value = value || '';
    return t;
  }
  function number(value, min, max, onInput) {
    return h('input', { 'class': 'table__input', type: 'number', min: String(min), max: String(max), value: value == null ? '' : String(value), oninput: function (e) { onInput(e.target.value === '' ? '' : Number(e.target.value)); dirty(); } });
  }
  function select(options, value, onChange) {
    var s = h('select', { 'class': 'table__input', onchange: function (e) { onChange(e.target.value); dirty(); } });
    options.forEach(function (o) {
      var opt = h('option', { value: o[0], text: o[1] });
      if (o[0] === value) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }
  function toggle(label, checked, onChange) {
    var input = h('input', { type: 'checkbox', checked: checked, onchange: function (e) { onChange(e.target.checked); dirty(); } });
    return h('label', { 'class': 'toggle' }, [input, h('span', { 'class': 'toggle__track' }), h('span', { text: label })]);
  }
  function chips(options, value, onChange) {
    var wrap = h('div', { 'class': 'chips' });
    options.forEach(function (o) {
      wrap.appendChild(h('button', { type: 'button', 'class': 'chip' + (o[0] === value ? ' is-on' : ''), text: o[1], onclick: function () {
        onChange(o[0]); dirty();
        Array.prototype.forEach.call(wrap.children, function (c, i) { c.classList.toggle('is-on', options[i][0] === o[0]); });
      } }));
    });
    return wrap;
  }
  function check(label, checked, onChange) {
    return h('label', { 'class': 'check' }, [h('input', { type: 'checkbox', checked: checked, onchange: function (e) { onChange(e.target.checked); dirty(); } }), h('span', { text: label })]);
  }
  function btn(label, cls, onClick) { return h('button', { type: 'button', 'class': 'btn ' + (cls || ''), text: label, onclick: onClick }); }
  function smallBtn(label, cls, onClick) { return btn(label, 'btn--small ' + (cls || ''), onClick); }
  function step(num, title, sub, children, off) {
    return h('div', { 'class': 'card step' + (off ? ' is-off' : ''), id: 'step-' + num }, [
      h('div', { 'class': 'step__head' }, [h('span', { 'class': 'step__num', text: String(num) }), h('div', {}, [h('h2', { 'class': 'step__title', text: title }), sub ? h('div', { 'class': 'step__sub', text: sub }) : null])])
    ].concat(children || []));
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------- server ----------
  function request(method, url, data) {
    return fetch(url, { method: method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' })
      .then(function (res) {
        return res.text().then(function (t) {
          var j; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
          if (!res.ok) throw new Error((j && j.error) || ('Server returned ' + res.status));
          return j;
        });
      });
  }

  // ---------- campaign data ----------
  function defaults() {
    return {
      copy: [''], headlines: [''],
      destination: 'landing', landingUrl: '',
      targeting: { locations: '', ageMin: 18, ageMax: 65, gender: 'all', mode: 'advantage', interests: '' },
      accountId: '',
      metaAdAccount: { id: '', name: '' },
      page: { id: '', name: '' },
      creativeIds: [],
      adSets: [],
      leadForm: {
        greetingOn: true, greetingHeadline: '', greetingDesc: '',
        questions: [], general: ['email', 'full_name', 'phone'], logicOn: false,
        privacyUrl: '', privacyDesc: '',
        thanks: { headline: '', desc: '', ctaLink: '', ctaLabel: '' }
      },
      landingPage: { pixelId: '', pixelName: '', objective: 'leads', event: 'Lead', customEvent: '' }
    };
  }
  function merge(base, over) {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
    var out = Object.assign({}, base);
    Object.keys(over).forEach(function (k) {
      out[k] = (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? merge(base[k], over[k]) : over[k];
    });
    return out;
  }

  function dirty() {
    if (!camp) return;
    setSave('Saving…', false);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }
  function save() {
    if (!camp) return Promise.resolve();
    var snapshot = { name: camp.name, status: camp.status, data: camp.data };
    return request('PUT', API + '/' + camp.id, snapshot).then(function (row) {
      setSave('Saved ' + new Date(row.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), false);
      var entry = campaigns.filter(function (c) { return c.id === camp.id; })[0];
      if (entry) { entry.name = row.name; entry.status = row.status; }
      var opt = root.querySelector('#campaignSelect option[value="' + camp.id + '"]');
      if (opt) opt.textContent = row.name;
    }, function (err) { setSave('Not saved: ' + err.message, true); });
  }
  function setSave(textValue, isError) {
    if (!saveState) return;
    saveState.textContent = textValue;
    saveState.classList.toggle('is-error', !!isError);
  }

  // ---------- top bar ----------
  function renderBar() {
    var sel = h('select', { 'class': 'table__input', id: 'campaignSelect', onchange: function (e) { if (e.target.value === '__new') createCampaign(); else openCampaign(e.target.value); } });
    campaigns.forEach(function (c) { var o = h('option', { value: c.id, text: c.name }); if (camp && c.id === camp.id) o.selected = true; sel.appendChild(o); });
    sel.appendChild(h('option', { value: '__new', text: '+ New campaign' }));
    if (!camp) { var ph = h('option', { value: '', text: 'Choose a campaign' }); ph.selected = true; sel.insertBefore(ph, sel.firstChild); }

    var bar = h('div', { 'class': 'builder__bar' }, [sel]);
    if (camp) {
      bar.appendChild(h('input', { 'class': 'table__input builder__name', id: 'campaignName', value: camp.name, placeholder: 'Campaign name', oninput: function (e) { camp.name = e.target.value.trim() || 'Untitled campaign'; dirty(); } }));
      bar.appendChild(h('span', { 'class': 'badge badge--' + (camp.status === 'launched' ? 'launched' : camp.status === 'ready' ? 'ready' : 'draft'), text: camp.status.charAt(0).toUpperCase() + camp.status.slice(1) }));
      bar.appendChild(smallBtn('Delete', 'btn--danger', function () {
        if (!confirm('Delete campaign "' + camp.name + '"? This cannot be undone.')) return;
        request('DELETE', API + '/' + camp.id).then(function () { camp = null; return loadList(); }).then(renderAll, function (err) { alert('Could not delete: ' + err.message); });
      }));
      saveState = h('span', { 'class': 'builder__save', text: 'Saved' });
      bar.appendChild(saveState);
    }
    return bar;
  }

  // ---------- steps ----------
  function stringList(items, placeholder, onChange, multiline) {
    var wrap = h('div', { 'class': 'list' });
    function draw() {
      wrap.innerHTML = '';
      items.forEach(function (val, i) {
        var input = multiline ? area(val, placeholder, function (v) { items[i] = v; }) : text(val, placeholder, function (v) { items[i] = v; });
        wrap.appendChild(h('div', { 'class': 'list-item' }, [
          h('span', { 'class': 'list-item__num', text: String(i + 1) }), input,
          smallBtn('✕', '', function () { items.splice(i, 1); if (!items.length) items.push(''); draw(); dirty(); onChange && onChange(); })
        ]));
      });
    }
    draw();
    return h('div', {}, [wrap, smallBtn('+ Add another', '', function () { items.push(''); draw(); dirty(); onChange && onChange(); })]);
  }

  function step1() { return step(1, 'Ad copy', 'Primary text shown above the creative. Add variants to test different angles.', [stringList(camp.data.copy, 'Write the ad copy…', null, true)]); }
  function step2() { return step(2, 'Headlines', 'Short and specific. Meta shows up to five per ad.', [stringList(camp.data.headlines, 'Headline')]); }

  function step3() {
    var d = camp.data;
    var urlField = field('Landing page URL', text(d.landingUrl, 'https://', function (v) { d.landingUrl = v; }, 'url'), 'Pixel and conversion settings are in step 9.');
    var formHint = h('p', { 'class': 'muted', text: 'Build the form in step 8.' });
    function sync() { urlField.hidden = d.destination !== 'landing'; formHint.hidden = d.destination !== 'leadform'; toggleSteps(); }
    var choice = chips([['landing', 'Landing page'], ['leadform', 'Instant lead form']], d.destination, function (v) { d.destination = v; sync(); });
    sync();
    return step(3, 'Destination', 'Where people go when they click the ad.', [choice, h('div', { style: 'height:12px' }), urlField, formHint]);
  }

  function targetingFields(t, includeGender) {
    var interests = field('Interests, behaviours, demographics', area(t.interests, 'e.g. Interested in home renovation; Homeowners; Age 30–55', function (v) { t.interests = v; }), 'One per line. Used only with detailed targeting.');
    function sync() { interests.hidden = t.mode !== 'detailed'; }
    var mode = chips([['advantage', 'Advantage+ audience'], ['detailed', 'Detailed targeting']], t.mode, function (v) { t.mode = v; sync(); });
    sync();
    var row = [field('Age from', number(t.ageMin, 13, 65, function (v) { t.ageMin = v; })), field('Age to', number(t.ageMax, 13, 65, function (v) { t.ageMax = v; }))];
    if (includeGender) row.push(field('Gender', select([['all', 'All'], ['men', 'Men'], ['women', 'Women']], t.gender, function (v) { t.gender = v; })));
    return h('div', {}, [
      field('Area / locations', area(t.locations, 'e.g. Sydney +40km; Melbourne; New South Wales', function (v) { t.locations = v; }, 2), 'Cities, regions, or radius targets, one per line.'),
      h('div', { 'class': 'field-row' }, row),
      field('Targeting type', mode),
      interests
    ]);
  }
  function step4() { return step(4, 'Targeting', 'Campaign defaults. Each ad set can use these or set its own in step 7.', [targetingFields(camp.data.targeting, true)]); }

  function syncedLabel(kind) {
    var at = meta[kind].syncedAt;
    return at ? 'Synced from Hermes ' + new Date(at).toLocaleString() : 'Not synced yet. Hermes sends this list with its access token.';
  }
  // Re-read what Hermes has sent (and pull from Hermes too, if the Advanced connection is set up),
  // then redraw the dropdowns in place. Resolves with a one-line summary.
  function fetchMeta() {
    return fetch('/api/hermes/meta', { method: 'POST' }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }, function () { return { ok: false, status: 0, body: {} }; })
      .then(function (pull) {
        return Promise.all([
          request('GET', '/api/meta'),
          request('GET', '/api/ad-accounts').then(function (l) { accounts = l || []; }, function () {})
        ]).then(function (r) {
          meta = r[0] || meta;
          if (camp) {
            var s5 = root.querySelector('#step-5'); if (s5) s5.replaceWith(step5());
            var s9 = root.querySelector('#step-9'); if (s9) s9.replaceWith(step9());
          }
          var n = function (k) { return meta[k].items.length; };
          var when = [meta.adAccounts.syncedAt, meta.pixels.syncedAt, meta.pages.syncedAt].filter(Boolean).sort().pop();
          var summary = n('adAccounts') + ' ad account' + (n('adAccounts') === 1 ? '' : 's') + ', ' + n('pixels') + ' pixel' + (n('pixels') === 1 ? '' : 's') + ', ' + n('pages') + ' page' + (n('pages') === 1 ? '' : 's');
          if (pull.ok) return 'Pulled from Hermes: ' + summary + '.';
          if (!when) return 'Nothing from Hermes yet. Ask Hermes to send the Meta data, then fetch again.';
          return 'Fetched: ' + summary + ' (Hermes sent this ' + new Date(when).toLocaleString() + ').';
        });
      });
  }
  var refreshMsg = '';
  function refreshButton() {
    var out = h('span', { 'class': 'field__hint', text: refreshMsg });
    refreshMsg = '';
    var b = smallBtn('Fetch from Hermes', '', function () {
      b.disabled = true; out.textContent = 'Fetching…';
      fetchMeta().then(function (msg) { refreshMsg = msg; var s5 = root.querySelector('#step-5'); if (s5) s5.replaceWith(step5()); }, function (err) { out.textContent = 'Fetch failed: ' + err.message; b.disabled = false; });
    });
    return h('div', { 'class': 'btn-row' }, [b, out]);
  }
  function step5() {
    var d = camp.data;
    // One dropdown: Meta ad accounts synced from Hermes, then the manual Ad Accounts tab.
    var sel = h('select', { 'class': 'table__input', onchange: function (e) {
      var v = e.target.value;
      if (v.indexOf('meta:') === 0) { var item = meta.adAccounts.items.filter(function (a) { return a.id === v.slice(5); })[0]; d.metaAdAccount = { id: v.slice(5), name: item ? item.name : v.slice(5) }; d.accountId = ''; }
      else if (v.indexOf('local:') === 0) { d.accountId = v.slice(6); d.metaAdAccount = { id: '', name: '' }; }
      else { d.accountId = ''; d.metaAdAccount = { id: '', name: '' }; }
      dirty();
    } });
    sel.appendChild(h('option', { value: '', text: 'Choose an ad account…' }));
    if (meta.adAccounts.items.length) {
      var g1 = h('optgroup', { label: 'Meta ad accounts (from Hermes)' });
      meta.adAccounts.items.forEach(function (a) { g1.appendChild(h('option', { value: 'meta:' + a.id, text: a.name + ' — ' + a.id + (a.currency ? ' · ' + a.currency : '') })); });
      sel.appendChild(g1);
    }
    if (accounts.length) {
      var g2 = h('optgroup', { label: 'Ad Accounts tab' });
      accounts.forEach(function (a) { g2.appendChild(h('option', { value: 'local:' + a.id, text: a.client + (a.company ? ' – ' + a.company : '') })); });
      sel.appendChild(g2);
    }
    sel.value = d.metaAdAccount && d.metaAdAccount.id ? 'meta:' + d.metaAdAccount.id : d.accountId ? 'local:' + d.accountId : '';
    if (sel.value !== (d.metaAdAccount && d.metaAdAccount.id ? 'meta:' + d.metaAdAccount.id : d.accountId ? 'local:' + d.accountId : '')) {
      // the saved choice is no longer in the list; keep showing it
      var keep = d.metaAdAccount && d.metaAdAccount.id ? h('option', { value: 'meta:' + d.metaAdAccount.id, text: (d.metaAdAccount.name || d.metaAdAccount.id) + ' (no longer in the synced list)' }) : null;
      if (keep) { sel.appendChild(keep); sel.value = keep.value; }
    }

    var pageSel = select([['', 'Choose a page…']].concat(meta.pages.items.map(function (p) { return [p.id, p.name + ' — ' + p.id]; })), d.page && d.page.id, function (v) {
      var item = meta.pages.items.filter(function (p) { return p.id === v; })[0];
      d.page = { id: v, name: item ? item.name : v };
    });
    if (d.page && d.page.id && !meta.pages.items.some(function (p) { return p.id === d.page.id; })) { var keepP = h('option', { value: d.page.id, text: (d.page.name || d.page.id) + ' (no longer in the synced list)' }); pageSel.appendChild(keepP); pageSel.value = d.page.id; }

    return step(5, 'Account selection', 'Which ad account and Facebook Page this campaign runs from.', [
      field('Ad account', sel, meta.adAccounts.items.length ? syncedLabel('adAccounts') : 'No Meta accounts synced yet. ' + (accounts.length ? 'Showing the Ad Accounts tab.' : 'Add accounts in the Ad Accounts tab or sync from Hermes.')),
      field('Facebook Page', pageSel, meta.pages.items.length ? syncedLabel('pages') : 'No pages synced yet. Hermes sends the pages the Meta token can access.'),
      refreshButton()
    ]);
  }

  function step6() {
    var d = camp.data;
    var grid = h('div', { 'class': 'creatives' });
    var status = h('div', { 'class': 'progress' });
    function drawGrid() {
      grid.innerHTML = '';
      if (!library.length) grid.appendChild(h('p', { 'class': 'muted', text: 'No creatives yet. Upload a file or add one by URL below.' }));
      library.forEach(function (c) {
        var on = d.creativeIds.indexOf(c.id) !== -1;
        var thumb;
        if (/^image\//.test(c.mime || '')) thumb = h('img', { 'class': 'creative__thumb', src: '/api/creatives/' + c.id, alt: c.name, loading: 'lazy' });
        else if (/^video\//.test(c.mime || '')) thumb = h('div', { 'class': 'creative__thumb creative__thumb--icon', text: '▶' });
        else thumb = h('div', { 'class': 'creative__thumb creative__thumb--icon', text: '🔗' });
        var tile = h('div', { 'class': 'creative' + (on ? ' is-on' : ''), title: c.url || c.name, onclick: function () {
          var i = d.creativeIds.indexOf(c.id);
          if (i === -1) d.creativeIds.push(c.id); else d.creativeIds.splice(i, 1);
          drawGrid(); dirty(); refreshAdSets();
        } }, [
          thumb,
          h('span', { 'class': 'creative__check', text: on ? '✓' : '' }),
          h('button', { type: 'button', 'class': 'creative__link', text: 'Copy link', title: 'Copy the shareable link Hermes will receive', onclick: function (e) {
            e.stopPropagation();
            var link = (c.url && !c.size) ? c.url : location.origin + '/api/creatives/' + c.id;
            var done = function () { e.target.textContent = 'Copied'; e.target.classList.add('is-copied'); setTimeout(function () { e.target.textContent = 'Copy link'; e.target.classList.remove('is-copied'); }, 1500); };
            if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, function () { prompt('Shareable link', link); });
            else prompt('Shareable link', link);
          } }),
          h('button', { type: 'button', 'class': 'creative__del', text: '✕', title: 'Delete from library', onclick: function (e) {
            e.stopPropagation();
            if (!confirm('Delete "' + c.name + '" from the creative library?')) return;
            request('DELETE', '/api/creatives/' + c.id).then(function () {
              library = library.filter(function (x) { return x.id !== c.id; });
              d.creativeIds = d.creativeIds.filter(function (id) { return id !== c.id; });
              drawGrid(); dirty(); refreshAdSets();
            }, function (err) { status.textContent = 'Could not delete: ' + err.message; });
          } }),
          h('div', { 'class': 'creative__name', text: c.name })
        ]);
        grid.appendChild(tile);
      });
    }
    drawGrid();

    // Upload
    var fileInput = h('input', { type: 'file', accept: 'image/*,video/*', multiple: 'multiple', onchange: function (e) { uploadFiles(e.target.files); e.target.value = ''; } });
    var drop = h('label', { 'class': 'drop' }, [fileInput, h('div', { text: 'Click to upload images or videos' }), h('div', { 'class': 'field__hint', text: 'Up to 3.5 MB each. Larger files: add by URL.' })]);
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('is-over'); uploadFiles(e.dataTransfer.files); });
    function uploadFiles(files) {
      var list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      var done = 0;
      status.textContent = 'Uploading 1 of ' + list.length + '…';
      list.reduce(function (chain, file) {
        return chain.then(function () {
          if (file.size > 3.5 * 1024 * 1024) { status.textContent = file.name + ' is over 3.5 MB. Add it by URL instead.'; return; }
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
            reader.onerror = function () { reject(new Error('Could not read ' + file.name)); };
            reader.readAsDataURL(file);
          }).then(function (base64) {
            return request('POST', '/api/creatives', { name: file.name, mime: file.type, data: base64 });
          }).then(function (row) {
            library.push(row); d.creativeIds.push(row.id); done++;
            status.textContent = 'Uploading ' + Math.min(done + 1, list.length) + ' of ' + list.length + '…';
            drawGrid(); dirty(); refreshAdSets();
          });
        });
      }, Promise.resolve()).then(function () { status.textContent = done ? 'Uploaded ' + done + ' file' + (done === 1 ? '' : 's') + '.' : status.textContent; },
        function (err) { status.textContent = 'Upload failed: ' + err.message; });
    }

    // Add by URL
    var urlName = h('input', { 'class': 'table__input', placeholder: 'Name' });
    var urlValue = h('input', { 'class': 'table__input', type: 'url', placeholder: 'https://link-to-the-creative' });
    var addUrl = smallBtn('Add by URL', 'btn--primary', function () {
      if (!urlName.value.trim() || !urlValue.value.trim()) { status.textContent = 'Give the creative a name and a URL.'; return; }
      request('POST', '/api/creatives', { name: urlName.value.trim(), url: urlValue.value.trim(), mime: /\.(mp4|mov|webm)(\?|$)/i.test(urlValue.value) ? 'video/link' : /\.(png|jpe?g|gif|webp)(\?|$)/i.test(urlValue.value) ? 'image/link' : '' })
        .then(function (row) { library.push(row); d.creativeIds.push(row.id); urlName.value = ''; urlValue.value = ''; status.textContent = 'Added.'; drawGrid(); dirty(); refreshAdSets(); },
          function (err) { status.textContent = 'Could not add: ' + err.message; });
    });
    var byUrl = h('div', {}, [field('Name', urlName), field('URL', urlValue), addUrl]);

    return step(6, 'Creative upload or selection', 'Tick the creatives this campaign uses. Each ticked creative becomes one ad.', [
      grid, h('div', { 'class': 'upload' }, [drop, byUrl]), status
    ]);
  }

  // Step 7: ad sets. Re-drawn when the creative selection changes.
  var adSetsBox = null;
  function refreshAdSets() { if (adSetsBox) drawAdSets(); }
  function drawAdSets() {
    var d = camp.data;
    adSetsBox.innerHTML = '';
    var selected = library.filter(function (c) { return d.creativeIds.indexOf(c.id) !== -1; });
    if (!d.adSets.length) adSetsBox.appendChild(h('p', { 'class': 'muted', text: 'No ad sets yet. Each ad set has its own audience and its own choice of ads.' }));
    d.adSets.forEach(function (set, i) {
      set.creativeIds = (set.creativeIds || []).filter(function (id) { return d.creativeIds.indexOf(id) !== -1; });
      var adChecks = h('div', { 'class': 'checks' });
      if (!selected.length) adChecks.appendChild(h('span', { 'class': 'muted', text: 'Select creatives in step 6 first.' }));
      selected.forEach(function (c) {
        adChecks.appendChild(check(c.name, set.creativeIds.indexOf(c.id) !== -1, function (on) {
          var k = set.creativeIds.indexOf(c.id);
          if (on && k === -1) set.creativeIds.push(c.id); else if (!on && k !== -1) set.creativeIds.splice(k, 1);
        }));
      });
      var custom = h('div', {}, [targetingFields(set.targeting, false)]);
      function sync() { custom.hidden = set.useCampaignTargeting; }
      var use = toggle('Use campaign targeting from step 4', set.useCampaignTargeting, function (v) { set.useCampaignTargeting = v; sync(); });
      sync();
      adSetsBox.appendChild(h('div', { 'class': 'subcard' }, [
        h('div', { 'class': 'subcard__head' }, [
          h('span', { 'class': 'step__num', text: String(i + 1) }),
          text(set.name, 'Ad set name', function (v) { set.name = v; }),
          smallBtn('Remove', 'btn--danger', function () { d.adSets.splice(i, 1); drawAdSets(); dirty(); })
        ]),
        field('Ads in this ad set', adChecks, 'Which of the selected creatives run here.'),
        field('Ad set setup', use),
        custom
      ]));
    });
    adSetsBox.appendChild(smallBtn('+ Add ad set', 'btn--primary', function () {
      d.adSets.push({ id: uid(), name: 'Ad set ' + (d.adSets.length + 1), creativeIds: selected.map(function (c) { return c.id; }), useCampaignTargeting: true, targeting: merge(defaults().targeting, d.targeting) });
      drawAdSets(); dirty();
    }));
  }
  function step7() { adSetsBox = h('div', {}); drawAdSets(); return step(7, 'Ad set builder', 'Choose which ads run in each ad set and how each one is targeted.', [adSetsBox]); }

  // Step 8: lead form
  function step8() {
    var f = camp.data.leadForm;
    var greetFields = h('div', {}, [
      field('Greeting headline', text(f.greetingHeadline, 'e.g. Get a free quote in 60 seconds', function (v) { f.greetingHeadline = v; })),
      field('Greeting description', area(f.greetingDesc, 'What people get by filling in the form', function (v) { f.greetingDesc = v; }, 2))
    ]);
    function syncGreet() { greetFields.hidden = !f.greetingOn; }
    var greet = toggle('Show a greeting screen', f.greetingOn, function (v) { f.greetingOn = v; syncGreet(); });
    syncGreet();

    var questionsBox = h('div', {});
    function logicTargets(fromIndex) {
      var list = [['', 'Next question']];
      f.questions.forEach(function (q, j) { if (j > fromIndex) list.push([q.id, 'Q' + (j + 1) + ': ' + (q.text || 'Untitled')]); });
      list.push(['general', 'Contact details']);
      list.push(['end_qualified', 'End: qualified lead']);
      list.push(['end_dq', 'End: disqualified']);
      return list;
    }
    function drawQuestions() {
      questionsBox.innerHTML = '';
      if (!f.questions.length) questionsBox.appendChild(h('p', { 'class': 'muted', text: 'No custom questions. Contact details are still collected below.' }));
      f.questions.forEach(function (q, i) {
        var body = h('div', {});
        function drawBody() {
          body.innerHTML = '';
          if (q.type === 'multi') {
            q.options = q.options && q.options.length ? q.options : [{ text: '', next: '' }, { text: '', next: '' }];
            q.options.forEach(function (o, k) {
              var row = h('div', { 'class': 'option-row' + (f.logicOn ? ' has-logic' : '') }, [
                text(o.text, 'Answer ' + (k + 1), function (v) { o.text = v; }),
                f.logicOn ? h('div', {}, [h('div', { 'class': 'logic-label', text: 'Then go to' }), select(logicTargets(i), o.next, function (v) { o.next = v; })]) : null,
                smallBtn('✕', '', function () { q.options.splice(k, 1); drawBody(); dirty(); })
              ]);
              body.appendChild(row);
            });
            body.appendChild(smallBtn('+ Add answer', '', function () { q.options.push({ text: '', next: '' }); drawBody(); dirty(); }));
          } else if (f.logicOn) {
            body.appendChild(field('After this answer, go to', select(logicTargets(i), q.next || '', function (v) { q.next = v; })));
          }
        }
        drawBody();
        questionsBox.appendChild(h('div', { 'class': 'subcard question' }, [
          h('div', { 'class': 'subcard__head' }, [
            h('span', { 'class': 'step__num', text: 'Q' + (i + 1) }),
            text(q.text, 'Question', function (v) { q.text = v; drawAllLogic(); }),
            select([['short', 'Short answer'], ['multi', 'Multiple choice']], q.type, function (v) { q.type = v; drawBody(); }),
            smallBtn('Remove', 'btn--danger', function () { f.questions.splice(i, 1); drawQuestions(); dirty(); })
          ]),
          body
        ]));
      });
      questionsBox.appendChild(smallBtn('+ Add question', 'btn--primary', function () { f.questions.push({ id: uid(), type: 'multi', text: '', options: [{ text: '', next: '' }, { text: '', next: '' }], next: '' }); drawQuestions(); dirty(); }));
    }
    var redrawTimer = null;
    function drawAllLogic() { if (!f.logicOn) return; clearTimeout(redrawTimer); redrawTimer = setTimeout(function () { var active = document.activeElement; if (active && active.tagName === 'INPUT') return; drawQuestions(); }, 1500); }
    drawQuestions();

    var general = h('div', { 'class': 'checks' });
    GENERAL_QUESTIONS.forEach(function (g) {
      general.appendChild(check(g[1], f.general.indexOf(g[0]) !== -1, function (on) {
        var k = f.general.indexOf(g[0]);
        if (on && k === -1) f.general.push(g[0]); else if (!on && k !== -1) f.general.splice(k, 1);
      }));
    });

    var logic = toggle('Conditional logic: each answer decides the next question', f.logicOn, function (v) { f.logicOn = v; drawQuestions(); });

    return step(8, 'Lead form builder', 'Used when the destination is an instant lead form.', [
      field('Greeting', greet), greetFields,
      field('Custom questions', questionsBox, 'Asked first, in order. Multiple choice answers can route people with conditional logic.'),
      field('Conditional logic', logic, f.logicOn ? 'Every answer must lead somewhere: another question, contact details, or an end page.' : ''),
      field('Contact details to collect', general),
      h('div', { 'class': 'field-row' }, [
        field('Privacy policy URL', text(f.privacyUrl, 'https://', function (v) { f.privacyUrl = v; }, 'url')),
        field('Privacy policy description', text(f.privacyDesc, 'e.g. We only use your details to contact you about this offer', function (v) { f.privacyDesc = v; }))
      ]),
      h('h3', { 'class': 'card__title', text: 'Thank you page' }),
      h('div', { 'class': 'field-row' }, [
        field('Headline', text(f.thanks.headline, 'Thanks, we will be in touch', function (v) { f.thanks.headline = v; })),
        field('Description', text(f.thanks.desc, 'What happens next', function (v) { f.thanks.desc = v; }))
      ]),
      h('div', { 'class': 'field-row' }, [
        field('CTA link', text(f.thanks.ctaLink, 'https://', function (v) { f.thanks.ctaLink = v; }, 'url')),
        field('CTA label', text(f.thanks.ctaLabel, 'e.g. Visit website', function (v) { f.thanks.ctaLabel = v; }))
      ])
    ], camp.data.destination !== 'leadform');
  }

  function step9() {
    var lp = camp.data.landingPage;
    var customField = field('Custom event name', text(lp.customEvent, 'e.g. QuoteRequested', function (v) { lp.customEvent = v; }));
    function sync() { customField.hidden = lp.event !== 'Custom'; }
    var ev = select(EVENTS.map(function (e) { return [e, e.replace(/([a-z])([A-Z])/g, '$1 $2')]; }), lp.event, function (v) { lp.event = v; sync(); });
    sync();
    var manual = text(lp.pixelId, 'e.g. 123456789012345', function (v) { lp.pixelId = v; lp.pixelName = ''; });
    var manualField = field('Pixel ID (manual)', manual);
    var pixelOptions = [['', 'Choose a pixel / dataset…']].concat(meta.pixels.items.map(function (px) { return [px.id, px.name + ' — ' + px.id]; })).concat([['__manual', 'Enter an ID manually']]);
    var known = meta.pixels.items.some(function (px) { return px.id === lp.pixelId; });
    var pixelSel = select(pixelOptions, known ? lp.pixelId : (lp.pixelId ? '__manual' : ''), function (v) {
      if (v === '__manual') { lp.pixelId = manual.value.trim(); lp.pixelName = ''; }
      else { var item = meta.pixels.items.filter(function (px) { return px.id === v; })[0]; lp.pixelId = v; lp.pixelName = item ? item.name : ''; }
      syncPixel();
    });
    function syncPixel() { manualField.hidden = pixelSel.value !== '__manual'; }
    syncPixel();
    return step(9, 'Landing page builder', 'Used when the destination is a landing page.', [
      h('div', { 'class': 'field-row' }, [
        field('Pixel / dataset', pixelSel, meta.pixels.items.length ? syncedLabel('pixels') : 'No pixels synced yet. Choose "Enter an ID manually" or sync from Hermes.'),
        field('Conversion objective', select(OBJECTIVES, lp.objective, function (v) { lp.objective = v; })),
        field('Conversion event', ev)
      ]),
      manualField,
      customField
    ], camp.data.destination !== 'landing');
  }

  function toggleSteps() {
    var s8 = root.querySelector('#step-8'), s9 = root.querySelector('#step-9');
    if (s8) s8.classList.toggle('is-off', camp.data.destination !== 'leadform');
    if (s9) s9.classList.toggle('is-off', camp.data.destination !== 'landing');
  }

  // ---------- launch ----------
  function problems() {
    var d = camp.data, list = [];
    if (!d.copy.some(function (c) { return c.trim(); })) list.push('Add at least one ad copy (step 1).');
    if (!d.headlines.some(function (c) { return c.trim(); })) list.push('Add at least one headline (step 2).');
    if (d.destination === 'landing' && !/^https?:\/\//i.test(d.landingUrl)) list.push('Enter a landing page URL (step 3).');
    if (!d.accountId && !(d.metaAdAccount && d.metaAdAccount.id)) list.push('Choose an ad account (step 5).');
    if (!d.creativeIds.length) list.push('Select at least one creative (step 6).');
    if (!d.adSets.length) list.push('Add at least one ad set (step 7).');
    d.adSets.forEach(function (s, i) { if (!s.creativeIds.length) list.push('Ad set ' + (i + 1) + ' has no ads (step 7).'); });
    if (d.destination === 'leadform') {
      if (!d.leadForm.general.length && !d.leadForm.questions.length) list.push('The lead form needs at least one question (step 8).');
      if (!/^https?:\/\//i.test(d.leadForm.privacyUrl)) list.push('Enter a privacy policy URL (step 8).');
      if (d.leadForm.logicOn) d.leadForm.questions.forEach(function (q, i) {
        if (q.type === 'multi') q.options.forEach(function (o, k) { if (!o.next) list.push('Q' + (i + 1) + ' answer ' + (k + 1) + ' needs a next step (step 8).'); });
        else if (!q.next) list.push('Q' + (i + 1) + ' needs a next step (step 8).');
      });
    }
    if (d.destination === 'landing' && !d.landingPage.pixelId.trim()) list.push('Enter the pixel ID (step 9).');
    return list;
  }
  function replyBox(title, r) {
    // r: { request?, status?, ok?, ms?, body?, error? }
    var meta = h('div', { 'class': 'reply__meta' }, [
      r.request ? h('span', { text: r.request }) : null,
      r.status != null ? h('span', { 'class': r.ok ? 'reply__ok' : 'reply__bad', text: 'HTTP ' + r.status + (r.ok ? ' OK' : '') }) : null,
      r.ms != null ? h('span', { text: r.ms + ' ms' }) : null
    ]);
    var bodyText = r.error ? r.error : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2));
    return h('div', { 'class': 'reply' }, [h('div', { 'class': 'step__sub', text: title, style: 'margin-bottom:6px' }), meta, h('pre', { text: bodyText || '(empty reply)' })]);
  }

  function launchCard() {
    var warn = h('ul', { 'class': 'warn-list' });
    var out = h('div', {});
    var launchBtn = btn(camp.status === 'launched' ? 'Launch again via Hermes' : 'Launch via Hermes', 'btn--primary', function () {
      var issues = problems();
      warn.innerHTML = ''; out.innerHTML = '';
      if (issues.length) { issues.forEach(function (p) { warn.appendChild(h('li', { text: p })); }); return; }
      launchBtn.disabled = true;
      out.appendChild(h('p', { 'class': 'progress', text: 'Sending the campaign to Hermes…' }));
      save().then(function () { return fetch('/api/hermes/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ campaignId: camp.id }) }); })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, body: j }; }); })
        .then(function (res) {
          out.innerHTML = '';
          if (res.ok) { camp.status = 'launched'; renderAll(); var box = root.querySelector('#launchOut'); if (box) box.appendChild(replyBox('Hermes accepted the campaign', res.body.reply)); }
          else out.appendChild(replyBox('Launch failed', res.body.reply ? Object.assign({ error: res.body.error }, res.body.reply, { body: res.body.reply.body }) : { error: res.body.error || ('Server returned ' + res.status) }));
        }, function (err) { out.innerHTML = ''; out.appendChild(replyBox('Launch failed', { error: err.message })); })
        .then(function () { launchBtn.disabled = false; });
    });
    var previewBtn = smallBtn('Preview what Hermes receives', '', function () {
      out.innerHTML = '';
      previewBtn.disabled = true;
      save().then(function () { return request('GET', '/api/hermes/preview?campaignId=' + encodeURIComponent(camp.id)); })
        .then(function (p) {
          out.appendChild(replyBox('Prompt (sent as payload.prompt)', { request: p.request, body: p.payload.prompt }));
          out.appendChild(replyBox('Full JSON payload', { body: p.payload }));
        }, function (err) { out.appendChild(replyBox('Preview failed', { error: err.message })); })
        .then(function () { previewBtn.disabled = false; });
    });
    var checkBtn = smallBtn('Check for problems', '', function () { var issues = problems(); warn.innerHTML = ''; (issues.length ? issues : ['Everything needed is filled in.']).forEach(function (p) { warn.appendChild(h('li', { text: p, style: issues.length ? '' : 'color: var(--success)' })); }); });
    return h('div', { 'class': 'card step', id: 'launchCard' }, [
      h('div', { 'class': 'step__head' }, [h('span', { 'class': 'step__num', text: '➜' }), h('div', {}, [h('h2', { 'class': 'step__title', text: 'Launch' }), h('div', { 'class': 'step__sub', text: 'Everything above is compiled into one prompt plus structured data and sent to Hermes in a single request. Asset links are public so Hermes can download them.' })])]),
      warn, h('div', { 'class': 'btn-row' }, [launchBtn, previewBtn, checkBtn]), h('div', { id: 'launchOut' }, [out])
    ]);
  }

  // ---------- Hermes config (bottom of the page) ----------
  function hermesCard() {
    var cfg = { hermesUrl: '', hermesKeyMasked: '', auth: 'bearer', launchPath: '/campaigns', testPath: '/health', testMethod: 'GET', publicBaseUrl: '', source: 'settings', hermesConfigured: false };
    var status = h('div', { 'class': 'notice' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Loading Hermes settings…' })]);
    function setStatus(kind, textValue) { status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = textValue; }
    var url = h('input', { 'class': 'table__input', type: 'url', placeholder: 'https://hermes.example.com/api', id: 'hermesUrl' });
    var key = h('input', { 'class': 'table__input', type: 'password', placeholder: 'Paste the Hermes API key', autocomplete: 'off', id: 'hermesKey' });
    var auth = h('select', { 'class': 'table__input', id: 'hermesAuth' }, [['bearer', 'Authorization: Bearer <key>'], ['x-api-key', 'X-API-Key: <key>'], ['both', 'Both headers']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    var launchPath = h('input', { 'class': 'table__input', placeholder: '/campaigns', id: 'hermesLaunchPath' });
    var testMethod = h('select', { 'class': 'table__input', id: 'hermesTestMethod' }, [h('option', { value: 'GET', text: 'GET' }), h('option', { value: 'POST', text: 'POST' })]);
    var testPath = h('input', { 'class': 'table__input', placeholder: '/health', id: 'hermesTestPath' });
    var publicBase = h('input', { 'class': 'table__input', type: 'url', placeholder: location.origin, id: 'hermesPublicBase' });
    var out = h('div', {});
    function fill() {
      url.value = cfg.hermesUrl || ''; auth.value = cfg.auth || 'bearer'; launchPath.value = cfg.launchPath || ''; testMethod.value = cfg.testMethod || 'GET'; testPath.value = cfg.testPath || ''; publicBase.value = cfg.publicBaseUrl || '';
      key.value = ''; key.placeholder = cfg.hermesKeyMasked ? 'Saved key ' + cfg.hermesKeyMasked + ' (paste a new one to replace)' : 'Paste the Hermes API key';
      var locked = cfg.source === 'env';
      [url, key, auth, launchPath, testMethod, testPath, publicBase, saveBtn].forEach(function (x) { x.disabled = locked; });
      setStatus(cfg.hermesConfigured ? 'ok' : '', cfg.hermesConfigured ? 'Hermes is connected' + (locked ? ' (configured through environment variables on the host).' : '. Use Test connection to check it answers.') : 'Not connected yet. Enter the Hermes URL and API key, save, then test.');
    }
    var saveBtn = btn('Save', 'btn--primary', function () {
      saveBtn.disabled = true;
      request('PUT', '/api/settings', { hermesUrl: url.value.trim(), hermesKey: key.value.trim(), auth: auth.value, launchPath: launchPath.value.trim(), testPath: testPath.value.trim(), testMethod: testMethod.value, publicBaseUrl: publicBase.value.trim() })
        .then(function (c) { cfg = c; fill(); setStatus(cfg.hermesConfigured ? 'ok' : '', cfg.hermesConfigured ? 'Saved. Hermes is connected. Use Test connection to check it answers.' : 'Saved. Add both the URL and key to connect.'); },
          function (err) { setStatus('error', 'Could not save: ' + err.message); })
        .then(function () { saveBtn.disabled = cfg.source === 'env'; });
    });
    var testBtn = btn('Test connection', '', function () {
      out.innerHTML = ''; testBtn.disabled = true;
      out.appendChild(h('p', { 'class': 'progress', text: 'Contacting Hermes…' }));
      var pending = key.value.trim() || url.value.trim() !== (cfg.hermesUrl || '');
      (pending ? request('PUT', '/api/settings', { hermesUrl: url.value.trim(), hermesKey: key.value.trim(), auth: auth.value, launchPath: launchPath.value.trim(), testPath: testPath.value.trim(), testMethod: testMethod.value, publicBaseUrl: publicBase.value.trim() }).then(function (c) { cfg = c; fill(); }) : Promise.resolve())
        .then(function () { return fetch('/api/hermes/test', { method: 'POST' }); })
        .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, status: res.status, body: j }; }); })
        .then(function (res) {
          out.innerHTML = '';
          if (res.ok) out.appendChild(replyBox(res.body.ok ? 'Hermes replied' : 'Hermes replied with an error', res.body));
          else out.appendChild(replyBox('Test failed', { error: res.body.error || ('Server returned ' + res.status) }));
        }, function (err) { out.innerHTML = ''; out.appendChild(replyBox('Test failed', { error: err.message })); })
        .then(function () { testBtn.disabled = false; });
    });
    request('GET', '/api/settings').then(function (c) { cfg = c; fill(); }, function (err) { setStatus('error', 'Could not load Hermes settings: ' + err.message); });

    // ---- Key that Hermes uses to call this app ----
    var keyState = { set: false, masked: '' };
    var keyBox = h('div', { 'class': 'apikey' });
    var keyOut = h('div', {});
    var seen = h('div', { 'class': 'notice' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Checking…' }), smallBtn('Check again', '', function () { loadSeen(); })]);
    var fetchOut = h('span', { 'class': 'field__hint' });
    var fetchBtn = btn('Fetch from Hermes', 'btn--primary', function () {
      fetchBtn.disabled = true; fetchOut.textContent = 'Fetching…';
      fetchMeta().then(function (msg) { fetchOut.textContent = msg; }, function (err) { fetchOut.textContent = 'Fetch failed: ' + err.message; }).then(function () { fetchBtn.disabled = false; });
    });
    var fetchRow = h('div', { 'class': 'btn-row', style: 'margin: 12px 0 16px' }, [fetchBtn, fetchOut]);
    function showSeen() {
      var ok = !!keyState.lastSeenAt;
      seen.className = 'notice' + (ok ? ' notice--ok' : '');
      seen.children[1].textContent = ok
        ? 'Connected. Hermes last called this app ' + new Date(keyState.lastSeenAt).toLocaleString() + ' (' + keyState.lastPath + ').'
        : (keyState.set ? 'Waiting for Hermes. Ask Hermes to call GET ' + location.origin + '/api/v1/ping with the key, then press Check again.' : 'Generate a key first.');
    }
    function loadSeen() { request('GET', '/api/apikey').then(function (r) { keyState = r; showSeen(); }, function () {}); }
    function drawKey(fresh) {
      keyBox.innerHTML = '';
      keyBox.appendChild(h('div', { 'class': 'apikey__head' }, [
        h('span', { 'class': 'apikey__name', text: 'ADBUILDER_API_KEY' }),
        h('span', { 'class': 'badge ' + (keyState.set ? 'badge--ready' : 'badge--draft'), text: keyState.set ? 'Set' : 'Not set' })
      ]));
      var value = h('div', { 'class': 'apikey__value' + (fresh ? ' is-fresh' : ''), text: fresh || (keyState.set ? keyState.masked : 'No key yet. Generate one and paste it into Hermes.') });
      var actions = h('div', { 'class': 'btn-row' });
      if (fresh) actions.appendChild(smallBtn('Copy', 'btn--primary', function (e) {
        var done = function () { e.target.textContent = 'Copied'; setTimeout(function () { e.target.textContent = 'Copy'; }, 1500); };
        if (navigator.clipboard) navigator.clipboard.writeText(fresh).then(done, function () { prompt('API key', fresh); }); else prompt('API key', fresh);
      }));
      actions.appendChild(smallBtn(keyState.set ? 'Replace' : 'Generate key', keyState.set ? '' : 'btn--primary', function () {
        if (keyState.set && !confirm('Replace the key? Hermes will stop working until the new key is pasted in.')) return;
        request('POST', '/api/apikey').then(function (r) { keyState = { set: true, masked: r.masked, lastSeenAt: null, lastPath: '' }; drawKey(r.key); showSeen(); }, function (err) { keyOut.textContent = 'Could not generate: ' + err.message; });
      }));
      if (keyState.set) actions.appendChild(smallBtn('Clear', 'btn--danger', function () {
        if (!confirm('Clear the key? Hermes will no longer be able to call this app.')) return;
        request('DELETE', '/api/apikey').then(function () { keyState = { set: false, masked: '', lastSeenAt: null, lastPath: '' }; drawKey(); showSeen(); }, function (err) { keyOut.textContent = 'Could not clear: ' + err.message; });
      }));
      keyBox.appendChild(h('div', { 'class': 'apikey__row' }, [value, actions]));
      if (fresh) keyBox.appendChild(h('div', { 'class': 'field__hint', text: 'This is the only time the full key is shown. Paste it into Hermes now; after that only the ending is visible here.' }));
    }
    request('GET', '/api/apikey').then(function (r) { keyState = r; drawKey(); showSeen(); }, function () { drawKey(); showSeen(); });
    var seenTimer = setInterval(function () { if (document.contains(seen) && !document.hidden) loadSeen(); else if (!document.contains(seen)) clearInterval(seenTimer); }, 10000);
    var base = location.origin;
    var endpoints = h('div', { 'class': 'reply' }, [
      h('div', { 'class': 'step__sub', text: 'What Hermes can call with that key (send it as Authorization: Bearer <key> or X-API-Key)', style: 'margin-bottom:6px' }),
      h('pre', { text: [
        'GET  ' + base + '/api/v1/ping                      → { ok: true }  (check the key)',
        'GET  ' + base + '/api/v1/campaigns                 → list of campaigns with status',
        'GET  ' + base + '/api/v1/campaigns/{id}            → full launch payload: prompt, campaign, assets',
        'POST ' + base + '/api/v1/campaigns/{id}/status     → { status: "launched", message, externalId }',
        'PUT  ' + base + '/api/v1/meta                      → { adAccounts: [{id,name}], pixels: [{id,name}], pages: [{id,name}] }  (sync from the Meta token)',
        'GET  ' + base + '/api/creatives/{id}               → the image/video bytes (links are in assets[].url)'
      ].join('\n') })
    ]);

    var advanced = h('details', { 'class': 'advanced' }, [
      h('summary', { text: 'Advanced: let this app call Hermes directly (Launch button, Refresh from Hermes)' }),
      status,
      h('div', { 'class': 'field-row' }, [field('Hermes URL', url, 'Base address. Paths below are added to it.'), field('Hermes API key', key)]),
      h('div', { 'class': 'field-row' }, [field('Send the key as', auth), field('Launch path', launchPath, 'POST, receives the campaign payload.')]),
      h('div', { 'class': 'field-row' }, [field('Test method', testMethod), field('Test path', testPath, 'GET calls it plainly; POST sends { prompt: "Connection test…" }.'), field('Public base URL for asset links', publicBase, 'Leave blank to use this site\'s address.')]),
      h('div', { 'class': 'btn-row' }, [saveBtn, testBtn]),
      out
    ]);
    if (cfg.hermesConfigured) advanced.open = true;

    return h('div', { 'class': 'card step hermes', id: 'hermesCard' }, [
      h('div', { 'class': 'step__head' }, [h('span', { 'class': 'step__num', text: 'H' }), h('div', {}, [h('h2', { 'class': 'step__title', text: 'Hermes access token' }), h('div', { 'class': 'step__sub', text: 'Generate a token, paste it into Hermes. Hermes then pulls campaigns, prompts, and assets from here and reports launch status back.' })])]),
      keyBox, keyOut, seen,
      h('p', { 'class': 'muted', text: 'After Hermes sends ad accounts, pixels, and pages, fetch them here. The dropdowns in steps 5 and 9 update without reloading the page.', style: 'margin: 16px 0 0' }),
      fetchRow, endpoints,
      advanced
    ]);
  }

  // ---------- assembly ----------
  function renderAll() {
    root.innerHTML = '';
    root.appendChild(renderBar());
    if (!camp) {
      root.appendChild(h('div', { 'class': 'card builder__empty' }, [
        h('p', { 'class': 'muted', text: campaigns.length ? 'Choose a campaign above or start a new one.' : 'No campaigns yet.' }),
        btn('New campaign', 'btn--primary', createCampaign)
      ]));
      root.appendChild(hermesCard());
      return;
    }
    [step1, step2, step3, step4, step5, step6, step7, step8, step9].forEach(function (fn) { root.appendChild(fn()); });
    root.appendChild(launchCard());
    root.appendChild(hermesCard());
  }

  function loadList() { return request('GET', API).then(function (list) { campaigns = list || []; }); }
  function loadRefs() {
    return Promise.all([
      request('GET', '/api/ad-accounts').then(function (l) { accounts = l || []; }, function () { accounts = []; }),
      request('GET', '/api/creatives').then(function (l) { library = l || []; }, function () { library = []; }),
      request('GET', '/api/meta').then(function (m) { if (m) meta = m; }, function () {})
    ]);
  }
  function openCampaign(id) {
    return Promise.all([request('GET', API + '/' + id), loadRefs()]).then(function (r) {
      var row = r[0];
      camp = { id: row.id, name: row.name, status: row.status, data: merge(defaults(), row.data || {}) };
      try { localStorage.setItem('adbuilder.lastCampaign', id); } catch (e) {}
      renderAll();
    }, function (err) { root.innerHTML = ''; root.appendChild(h('div', { 'class': 'notice notice--error' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Could not load the campaign: ' + err.message })])); });
  }
  function createCampaign() {
    request('POST', API, { name: 'New campaign', data: defaults() }).then(function (row) { return loadList().then(function () { return openCampaign(row.id); }); },
      function (err) { alert('Could not create a campaign: ' + err.message); });
  }

  function init() {
    root.appendChild(h('p', { 'class': 'muted', text: 'Loading…' }));
    loadList().then(function () {
      var last = null;
      try { last = localStorage.getItem('adbuilder.lastCampaign'); } catch (e) {}
      if (last && campaigns.some(function (c) { return c.id === last; })) return openCampaign(last);
      if (campaigns.length === 1) return openCampaign(campaigns[0].id);
      renderAll();
    }, function (err) {
      root.innerHTML = '';
      root.appendChild(h('div', { 'class': 'notice notice--error' }, [h('span', { 'class': 'notice__dot' }), h('span', { text: 'Ad Builder needs the server API: ' + err.message })]));
    });
  }

  // Reload the ad account list when the tab is opened, in case accounts changed.
  window.addEventListener('hashchange', function () { if (location.hash === '#ad-builder' && camp) loadRefs().then(function () { var s5 = root.querySelector('#step-5'); if (s5) s5.replaceWith(step5()); }); });

  init();
})();
