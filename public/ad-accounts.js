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
  var STATUS_LABELS = { green: 'Good', amber: 'OK', red: 'Bad' };
  var STATUS_RANK = { green: 1, amber: 2, red: 3 };

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
  function load() {
    var seq = ++loadSeq;
    return request('GET', API).then(function (list) {
      if (seq !== loadSeq) return;   // an older response arriving late; a newer one is on its way
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
      render();
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
  function statusCell(account, field) {
    var value = account[field] || '';
    var select = el('select', { 'class': 'status status--' + (value || 'none'), 'data-field': field, title: 'Click to change', 'aria-label': field });
    select.appendChild(el('option', { value: '', text: '—' }));
    Object.keys(STATUS_LABELS).forEach(function (key) {
      var opt = el('option', { value: key, text: STATUS_LABELS[key] });
      if (key === value) opt.setAttribute('selected', 'selected');
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      if (account.id === 'new') { account[field] = select.value; select.className = 'status status--' + (select.value || 'none'); return; }
      saveField(account, field, select.value);
    });
    return el('td', { 'class': 'cell-status' }, [select]);
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
        button('Delete', 'btn--danger', function () {
          if (!confirm('Delete the ad account for ' + (account.client || 'this client') + '?')) return;
          request('DELETE', API + '/' + account.id).then(load, failed('delete the account'));
        })
      ])])
    ]);
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
  setInterval(function () { if (!editing && !draft && !document.hidden) load(); }, POLL_MS);
})();
