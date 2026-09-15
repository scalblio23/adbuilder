// Ad Accounts table backed by the server API (see server.js / api/).
// Click any cell to edit it in place. Status columns are colour blocks that change on click.
(function () {
  var API = '/api/ad-accounts';
  var POLL_MS = 5000;

  var body = document.getElementById('accountsBody');
  var empty = document.getElementById('accountsEmpty');
  var addButton = document.getElementById('addAccount');
  var notice = document.getElementById('accountsNotice');
  var noticeText = document.getElementById('accountsNoticeText');
  var sortButtons = document.querySelectorAll('.sort');

  var TEXT_FIELDS = { client: 'Client name', company: 'Company name', link: 'https://', rules: 'Rules or notes' };
  var STATUS_FIELDS = ['leads', 'bookings', 'conversion', 'mood'];
  var STATUS_LABELS = { green: 'Good', amber: 'OK', red: 'Bad', notlive: 'Not Live' };
  var STATUS_RANK = { green: 1, amber: 2, red: 3, notlive: 4 };

  var accounts = [];
  var editing = null;     // { id, field } for the cell being edited, or null
  var draft = null;       // unsaved new row
  var connected = false;
  var sortKey = null;
  var sortDir = 'asc';

  function setNotice(kind, text) {
    notice.className = 'notice' + (kind ? ' notice--' + kind : '');
    noticeText.textContent = text;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'onclick') node.addEventListener('click', attrs[key]);
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }
  function button(label, extraClass, onclick) {
    return el('button', { type: 'button', 'class': 'btn btn--small ' + (extraClass || ''), text: label, onclick: onclick });
  }
  function fieldInput(name, value) {
    var node;
    if (name === 'rules') {
      node = el('textarea', { 'class': 'table__input table__textarea', 'data-field': name, placeholder: TEXT_FIELDS[name], rows: '3' });
      node.value = value || '';
    } else {
      node = el('input', { 'class': 'table__input', 'data-field': name, value: value || '', placeholder: TEXT_FIELDS[name], type: name === 'link' ? 'url' : 'text' });
    }
    return node;
  }

  // ---- Server ----
  function request(method, url, data) {
    return fetch(url, {
      method: method,
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      if (res.ok) return res.status === 204 ? null : res.json();
      return res.json().catch(function () { return {}; }).then(function (info) {
        throw new Error(info.error || ('Server returned ' + res.status));
      });
    });
  }

  var loadSeq = 0;
  var lastJson = '';
  function load() {
    loadBookings().then(function (changed) { if (changed && accounts.length && !editing && !draft) render(); });
    var seq = ++loadSeq;
    return request('GET', API).then(function (list) {
      if (seq !== loadSeq) return;   // an older response arriving late; a newer one is on its way
      var json = JSON.stringify(list);
      var changed = json !== lastJson;
      lastJson = json;
      accounts = Array.isArray(list) ? list : [];
      if (!connected) {
        connected = true;
        setNotice('ok', 'Connected. Click any cell to edit it.');
        fetch('/api/health', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (h) {
          if (h && h.storage === 'postgres') setNotice('ok', 'Connected to the shared database. Click any cell to edit it.');
          else if (h && h.storage === 'file') setNotice('ok', 'Connected. Accounts are saved to a file on the server. Click any cell to edit it.');
        }).catch(function () {});
      }
      if (editing && !accounts.some(function (a) { return a.id === editing.id; })) editing = null;
      if (changed && !menu) render();
    }, function (err) {
      connected = false;
      if (/404/.test(err.message)) setNotice('error', 'The site is deployed without its API. On Vercel, make sure the api/ folder deployed and a Postgres database is attached. (' + err.message + ')');
      else setNotice('error', 'Not connected to the server. Open the site through its server address, not as a local file. (' + err.message + ')');
      render();
    });
  }

  function failed(action) {
    return function (err) {
      setNotice('error', 'Could not ' + action + ': ' + err.message);
      load();
    };
  }

  function payload(account, changes) {
    var data = {};
    Object.keys(TEXT_FIELDS).forEach(function (f) { data[f] = account[f] || ''; });
    STATUS_FIELDS.forEach(function (f) { data[f] = account[f] || ''; });
    Object.keys(changes || {}).forEach(function (f) { data[f] = changes[f]; });
    return data;
  }

  function saveField(account, field, value) {
    if ((account[field] || '') === value) { editing = null; render(); return; }
    var change = {};
    change[field] = value;
    account[field] = value;        // show the change immediately
    editing = null;
    render();
    request('PUT', API + '/' + account.id, change).then(load, failed('save the change'));
  }

  // ---- Cells ----
  // ---- Status cells: a solid colour block; click opens a colour picker ----
  var menu = null;        // the open picker, if any
  function closeMenu() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
  }
  function onOutside(event) { if (menu && !menu.contains(event.target)) closeMenu(); }
  function onMenuKey(event) { if (event.key === 'Escape') closeMenu(); }

  function paintStatus(block, value) {
    block.className = 'status status--' + (value || 'none');
    block.textContent = STATUS_LABELS[value] || '';
  }

  function openMenu(block, account, field) {
    closeMenu();
    menu = el('div', { 'class': 'status-menu', role: 'listbox' });
    var current = account[field] || '';
    Object.keys(STATUS_LABELS).forEach(function (key) {
      var opt = el('button', { type: 'button', 'class': 'status-menu__option status--' + key + (key === current ? ' is-current' : ''), text: STATUS_LABELS[key], role: 'option' });
      opt.addEventListener('click', function () { choose(key); });
      menu.appendChild(opt);
    });
    var clear = el('button', { type: 'button', 'class': 'status-menu__option status-menu__clear', text: 'Clear', role: 'option' });
    clear.addEventListener('click', function () { choose(''); });
    menu.appendChild(clear);

    function choose(value) {
      closeMenu();
      if ((account[field] || '') === value) return;
      var previous = account[field] || '';
      account[field] = value;
      paintStatus(block, value);           // instant, no table rebuild
      if (account.id === 'new') return;    // draft rows save with the row
      var change = {}; change[field] = value;
      request('PUT', API + '/' + account.id, change).then(function () { load(); }, function (err) {
        account[field] = previous;
        paintStatus(block, previous);
        setNotice('error', 'Could not save the change: ' + err.message);
      });
    }

    document.body.appendChild(menu);
    var r = block.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.min(r.left, window.innerWidth - mw - 8);
    var top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
    menu.style.left = Math.max(8, left + window.scrollX) + 'px';
    menu.style.top = (top + window.scrollY) + 'px';
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    var first = menu.querySelector('.is-current') || menu.firstChild;
    first.focus();
  }

  function statusCell(account, field) {
    var block = el('button', { type: 'button', 'data-field': field, title: 'Click to change', 'aria-label': field + ' status' });
    paintStatus(block, account[field] || '');
    block.addEventListener('click', function (event) { event.stopPropagation(); openMenu(block, account, field); });
    return el('td', { 'class': 'cell-status' }, [block]);
  }

  function textCell(account, field) {
    var isEditing = editing && editing.id === account.id && editing.field === field;
    if (isEditing) {
      var input = fieldInput(field, account[field]);
      var done = false;
      function commit() {
        if (done) return; done = true;
        var value = input.value.trim();
        if (field === 'client' && !value) { editing = null; render(); return; }   // name can't be blank; discard
        saveField(account, field, value);
      }
      function cancel() { if (done) return; done = true; editing = null; render(); }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', function (event) {
        var multiline = input.tagName === 'TEXTAREA';
        if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      });
      setTimeout(function () { input.focus(); if (input.select) input.select(); }, 0);
      return el('td', { 'class': 'cell-editing' }, [input]);
    }

    var value = account[field] || '';
    var cell = el('td', { 'class': 'cell-editable', title: 'Click to edit', tabindex: '0' });
    if (!value) cell.appendChild(el('span', { 'class': 'muted', text: field === 'client' ? 'Add a name' : '—' }));
    else if (field === 'rules') cell.appendChild(el('div', { 'class': 'rules-text', text: value }));
    else if (field === 'link') {
      cell.appendChild(el('span', { 'class': 'link-text', text: value }));
      var open = el('a', { 'class': 'link link--open', href: value, target: '_blank', rel: 'noopener', text: 'Open ↗', title: 'Open in a new tab' });
      open.addEventListener('click', function (event) { event.stopPropagation(); });
      cell.appendChild(open);
    } else cell.appendChild(el('span', { text: value }));

    function startEdit() { editing = { id: account.id, field: field }; render(); }
    cell.addEventListener('click', startEdit);
    cell.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); startEdit(); } });
    return cell;
  }

  function viewRow(account, number) {
    return el('tr', {}, [
      el('td', { 'class': 'table__num', text: String(number) }),
      textCell(account, 'client'),
      textCell(account, 'company'),
      statusCell(account, 'leads'),
      statusCell(account, 'bookings'),
      statusCell(account, 'conversion'),
      statusCell(account, 'mood'),
      textCell(account, 'link'),
      textCell(account, 'rules'),
      el('td', {}, [el('div', { 'class': 'table__actions' }, [
        button(bookingsLabel(account), '', function () { openBookings(account); }),
        button('Delete', 'btn--danger', function () {
          if (!confirm('Delete the ad account for ' + (account.client || 'this client') + '?')) return;
          request('DELETE', API + '/' + account.id).then(load, failed('delete the account'));
        })
      ])])
    ]);
  }

  // ---- Bookings log per client: dates and counts, tied to the Meta ad account this client runs on ----
  var bookingsByAccount = {}, lastBookingsJson = '';
  function loadBookings() {
    return request('GET', '/api/bookings').then(function (list) {
      var json = JSON.stringify(list || []);
      if (json === lastBookingsJson) return false;
      lastBookingsJson = json;
      bookingsByAccount = {}; (list || []).forEach(function (b) { bookingsByAccount[b.accountId] = b; });
      return true;
    }, function () { return false; });
  }
  function bookingsLabel(account) {
    var b = bookingsByAccount[account.id];
    return b && b.total ? (b.label || 'Bookings') + ' · ' + b.total : 'Bookings';
  }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function openBookings(account) {
    var b = bookingsByAccount[account.id] || { metaAccountId: '', label: 'Bookings', entries: [] };
    var entries = b.entries.map(function (e) { return { date: e.date, count: e.count }; });
    var panel = el('div', { 'class': 'picker__panel' });
    var overlay = el('div', { 'class': 'picker' }, [panel]);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(event) { if (event.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    var status = el('div', { 'class': 'notice', hidden: '' }, [el('span', { 'class': 'notice__dot' }), el('span')]);
    function say(kind, text) { status.hidden = !text; status.className = 'notice' + (kind ? ' notice--' + kind : ''); status.lastChild.textContent = text || ''; }

    var acctSel = el('select', { 'class': 'table__input' });
    acctSel.appendChild(el('option', { value: '', text: 'Choose the Meta ad account…' }));
    var acctHint = el('span', { 'class': 'field__hint', text: 'Loading ad accounts…' });
    request('GET', '/api/tracked').then(function (o) {
      var known = (o && o.accounts) || [];
      known.forEach(function (a) { acctSel.appendChild(el('option', { value: a.id, text: a.name + ' — ' + a.id })); });
      if (b.metaAccountId && !known.some(function (a) { return a.id === b.metaAccountId; })) acctSel.appendChild(el('option', { value: b.metaAccountId, text: b.metaAccountId }));
      acctSel.value = b.metaAccountId || '';
      acctHint.textContent = known.length ? 'The bookings roll up to this account on the Campaigns tab when its client pill is on.' + (b.linkedFromLink ? ' Prefilled from the ad account link.' : '') : 'No Meta ad accounts known yet: connect Meta on the Campaigns tab, or put the Ads Manager link (with act=) in the Ad Account Link column.';
    }, function () { acctHint.textContent = 'Could not load the ad account list.'; });
    var labelIn = el('input', { 'class': 'table__input', value: b.label || 'Bookings', placeholder: 'Bookings', maxlength: '40' });

    var tbody = el('tbody');
    var totalEl = el('strong');
    function total() { return entries.reduce(function (n, e) { return n + (Number(e.count) || 0); }, 0); }
    function drawRows() {
      tbody.innerHTML = '';
      entries.sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; });
      entries.forEach(function (e, i) {
        var date = el('input', { 'class': 'table__input', type: 'date', value: e.date });
        var count = el('input', { 'class': 'table__input bk__count', type: 'number', min: '0', step: '1', value: String(e.count) });
        date.addEventListener('change', function () { e.date = date.value; });
        count.addEventListener('input', function () { e.count = Number(count.value) || 0; totalEl.textContent = String(total()); });
        var del = button('×', 'btn--danger btn--small', function () { entries.splice(i, 1); drawRows(); });
        tbody.appendChild(el('tr', {}, [el('td', {}, [date]), el('td', {}, [count]), el('td', { 'class': 'table__actions-col' }, [del])]));
      });
      totalEl.textContent = String(total());
      emptyRow.hidden = entries.length > 0;
    }
    var emptyRow = el('p', { 'class': 'muted', text: 'No bookings logged yet. Add a row per day.' });
    var addBtn = button('+ Add a day', '', function () { entries.push({ date: todayIso(), count: 1 }); drawRows(); var last = tbody.lastChild && tbody.lastChild.querySelector('input[type=number]'); if (last) { last.focus(); last.select(); } });
    var pasteBtn = button('Paste a list', '', function () {
      var text = prompt('Paste lines like "28 Jul 2" or "2026-07-28, 2" (one per line). Rows with the same date add up.');
      if (!text) return;
      var year = new Date().getFullYear(), months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], added = 0;
      text.split(/\r?\n/).forEach(function (line) {
        var m = /(\d{4}-\d{2}-\d{2})\D+(\d+)/.exec(line) || null, date = '', n = 0;
        if (m) { date = m[1]; n = Number(m[2]); }
        else {
          var m2 = /(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\.?(?:\s+(\d{4}))?\D+(\d+)\s*$/.exec(line.trim());
          if (!m2) return;
          var mi = months.indexOf(m2[2].toLowerCase()); if (mi < 0) return;
          date = (m2[3] || year) + '-' + ('0' + (mi + 1)).slice(-2) + '-' + ('0' + m2[1]).slice(-2); n = Number(m2[4]);
        }
        if (!date || !(n >= 0)) return;
        var hit = entries.filter(function (e) { return e.date === date; })[0];
        if (hit) hit.count = (Number(hit.count) || 0) + n; else entries.push({ date: date, count: n });
        added++;
      });
      drawRows();
      say(added ? 'ok' : 'error', added ? added + ' line' + (added === 1 ? '' : 's') + ' added. Save to keep them.' : 'No lines understood. Use "28 Jul 2" or "2026-07-28 2".');
    });
    var saveBtn = button('Save', 'btn--primary', function () {
      var bad = entries.filter(function (e) { return !/^\d{4}-\d{2}-\d{2}$/.test(e.date || ''); });
      if (bad.length) return say('error', 'Every row needs a date.');
      saveBtn.disabled = true; say('', 'Saving…');
      request('PUT', '/api/bookings/' + account.id, { metaAccountId: acctSel.value, label: labelIn.value.trim() || 'Bookings', entries: entries.map(function (e) { return { date: e.date, count: Number(e.count) || 0 }; }) })
        .then(function (saved) { bookingsByAccount[account.id] = saved; close(); render(); }, function (err) { saveBtn.disabled = false; say('error', 'Could not save: ' + err.message); });
    });
    drawRows();
    panel.appendChild(el('div', { 'class': 'picker__head' }, [el('h3', { 'class': 'card__title', text: (account.client || 'Client') + ' · bookings' }), button('Close', '', close)]));
    panel.appendChild(el('p', { 'class': 'muted', text: 'Log the bookings this client got, by day. They show as metric cards on the Campaigns tab (count and cost per booking) for the timeframe chosen there, using the spend of this client\'s campaigns.' }));
    panel.appendChild(el('div', { 'class': 'field-row' }, [
      el('div', { 'class': 'field' }, [el('label', { text: 'Meta ad account' }), acctSel, acctHint]),
      el('div', { 'class': 'field' }, [el('label', { text: 'Call them' }), labelIn, el('span', { 'class': 'field__hint', text: 'e.g. Bookings, Calls, Appointments. Cost per one is named after it.' })])
    ]));
    panel.appendChild(el('div', { 'class': 'picker__list bk__list' }, [el('table', { 'class': 'table bk' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Date' }), el('th', { text: 'Count' }), el('th', {})])]), tbody]), emptyRow]));
    panel.appendChild(el('div', { 'class': 'picker__foot' }, [el('div', { 'class': 'btn-row' }, [addBtn, pasteBtn]), el('div', { 'class': 'bk__total' }, [el('span', { 'class': 'muted', text: 'Total ' }), totalEl]), saveBtn]));
    panel.appendChild(status);
    document.body.appendChild(overlay);
  }

  // New rows use a full editing row with Save / Cancel.
  function draftRow(account, number) {
    var inputs = {};
    Object.keys(TEXT_FIELDS).forEach(function (f) { inputs[f] = fieldInput(f, account[f]); });

    function commit() {
      var client = inputs.client.value.trim();
      inputs.client.classList.toggle('is-invalid', !client);
      if (!client) { inputs.client.focus(); return; }
      var data = payload(account, {});
      Object.keys(TEXT_FIELDS).forEach(function (f) { data[f] = inputs[f].value.trim(); });
      draft = null;
      request('POST', API, data).then(load, failed('add the account'));
    }
    function cancel() { draft = null; render(); }

    var row = el('tr', { 'class': 'is-editing' }, [
      el('td', { 'class': 'table__num', text: String(number) }),
      el('td', {}, [inputs.client]),
      el('td', {}, [inputs.company]),
      statusCell(account, 'leads'),
      statusCell(account, 'bookings'),
      statusCell(account, 'conversion'),
      statusCell(account, 'mood'),
      el('td', {}, [inputs.link]),
      el('td', {}, [inputs.rules]),
      el('td', {}, [el('div', { 'class': 'table__actions' }, [
        button('Save', 'btn--primary', commit),
        button('Cancel', '', cancel)
      ])])
    ]);
    row.addEventListener('keydown', function (event) {
      var multiline = event.target && event.target.tagName === 'TEXTAREA';
      if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    setTimeout(function () { inputs.client.focus(); }, 0);
    return row;
  }

  // ---- Sorting and rendering ----
  function sorted() {
    var rows = accounts.map(function (account, index) { return { account: account, number: index + 1 }; });
    if (!sortKey) return rows;
    var dir = sortDir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      if (sortKey === 'number') return (a.number - b.number) * dir;
      if (STATUS_FIELDS.indexOf(sortKey) !== -1) {
        var ra = STATUS_RANK[a.account[sortKey]] || 99, rb = STATUS_RANK[b.account[sortKey]] || 99;
        if (ra === rb) return a.number - b.number;
        if (ra === 99) return 1;
        if (rb === 99) return -1;
        return (ra - rb) * dir;
      }
      var x = String(a.account[sortKey] || '').toLowerCase();
      var y = String(b.account[sortKey] || '').toLowerCase();
      if (x === y) return a.number - b.number;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y) * dir;
    });
    return rows;
  }

  function render() {
    body.innerHTML = '';
    sorted().forEach(function (row) { body.appendChild(viewRow(row.account, row.number)); });
    if (draft) body.appendChild(draftRow(draft, accounts.length + 1));
    empty.hidden = accounts.length > 0 || !!draft;
    addButton.disabled = !connected || !!draft;
    sortButtons.forEach(function (btn) {
      var active = btn.dataset.sort === sortKey;
      btn.classList.toggle('is-asc', active && sortDir === 'asc');
      btn.classList.toggle('is-desc', active && sortDir === 'desc');
    });
  }

  sortButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.dataset.sort;
      if (sortKey !== key) { sortKey = key; sortDir = 'asc'; }
      else if (sortDir === 'asc') sortDir = 'desc';
      else { sortKey = null; sortDir = 'asc'; }
      render();
    });
  });

  addButton.addEventListener('click', function () {
    draft = { id: 'new', client: '', company: '', link: '', rules: '', leads: '', bookings: '', conversion: '', mood: '' };
    render();
  });

  render();
  load();
  // Pick up other people's changes; pause while something is being edited.
  setInterval(function () { if (!editing && !draft && !menu && !document.hidden) load(); }, POLL_MS);
})();
