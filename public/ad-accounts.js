// Ad Accounts table backed by the server API (see server.js).
// Everyone who opens the site shares the same list.
(function () {
  var API = '/api/ad-accounts';
  var POLL_MS = 5000;

  var body = document.getElementById('accountsBody');
  var empty = document.getElementById('accountsEmpty');
  var addButton = document.getElementById('addAccount');
  var notice = document.getElementById('accountsNotice');
  var noticeText = document.getElementById('accountsNoticeText');

  var accounts = [];
  var editingId = null;   // id of the row being edited, or 'new'
  var draft = null;       // unsaved new row
  var connected = false;
  var sortKey = null;     // 'number' | 'client' | 'company' | 'link' | null (original order)
  var sortDir = 'asc';
  var sortButtons = document.querySelectorAll('.sort');

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
  function input(name, value, placeholder) {
    return el('input', { 'class': 'table__input', 'data-field': name, value: value || '', placeholder: placeholder, type: name === 'link' ? 'url' : 'text' });
  }
  function textarea(name, value, placeholder) {
    var node = el('textarea', { 'class': 'table__input table__textarea', 'data-field': name, placeholder: placeholder, rows: '2' });
    node.value = value || '';
    return node;
  }
  function urlList(urls) {
    var list = el('div', { 'class': 'url-list' });
    var items = String(urls || '').split('\n').filter(Boolean);
    if (!items.length) return el('span', { 'class': 'muted', text: '—' });
    items.forEach(function (u) { list.appendChild(el('a', { 'class': 'link', href: u, target: '_blank', rel: 'noopener', text: u })); });
    return list;
  }

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

  function load() {
    return request('GET', API).then(function (list) {
      accounts = Array.isArray(list) ? list : [];
      if (!connected) {
        connected = true;
        setNotice('ok', 'Connected. Everyone who opens this site sees the same accounts.');
        fetch('/api/health', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (h) {
          if (h && h.storage === 'postgres') setNotice('ok', 'Connected to the shared database. Everyone who opens this site sees the same accounts.');
          else if (h && h.storage === 'file') setNotice('ok', 'Connected. Accounts are saved to a file on the server.');
        }).catch(function () {});
      }
      if (editingId && editingId !== 'new' && !accounts.some(function (a) { return a.id === editingId; })) editingId = null;
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

  function viewRow(account, number) {
    var linkCell = el('td');
    if (account.link) linkCell.appendChild(el('a', { 'class': 'link', href: account.link, target: '_blank', rel: 'noopener', text: account.link }));
    else linkCell.appendChild(el('span', { 'class': 'muted', text: '—' }));
    return el('tr', {}, [
      el('td', { 'class': 'table__num', text: String(number) }),
      el('td', { text: account.client }),
      el('td', { text: account.company }),
      linkCell,
      el('td', {}, [urlList(account.urls)]),
      el('td', {}, [el('div', { 'class': 'table__actions' }, [
        button('Edit', '', function () { editingId = account.id; render(); }),
        button('Delete', 'btn--danger', function () {
          if (!confirm('Delete the ad account for ' + (account.client || 'this client') + '?')) return;
          request('DELETE', API + '/' + account.id).then(load, failed('delete the account'));
        })
      ])])
    ]);
  }

  function editRow(account, number) {
    var isNew = account.id === 'new';
    var clientInput = input('client', account.client, 'Client name');
    var companyInput = input('company', account.company, 'Company name');
    var linkInput = input('link', account.link, 'https://');
    var urlsInput = textarea('urls', account.urls, 'One URL per line');

    function commit() {
      var client = clientInput.value.trim();
      clientInput.classList.toggle('is-invalid', !client);
      if (!client) { clientInput.focus(); return; }
      var data = { client: client, company: companyInput.value.trim(), link: linkInput.value.trim(), urls: urlsInput.value.trim() };
      var write = isNew ? request('POST', API, data) : request('PUT', API + '/' + account.id, data);
      editingId = null; draft = null;
      write.then(load, failed('save the account'));
    }
    function cancel() { editingId = null; draft = null; render(); }

    var row = el('tr', { 'class': 'is-editing' }, [
      el('td', { 'class': 'table__num', text: String(number) }),
      el('td', {}, [clientInput]),
      el('td', {}, [companyInput]),
      el('td', {}, [linkInput]),
      el('td', {}, [urlsInput]),
      el('td', {}, [el('div', { 'class': 'table__actions' }, [
        button('Save', 'btn--primary', commit),
        button('Cancel', '', cancel)
      ])])
    ]);
    row.addEventListener('keydown', function (event) {
      var inTextarea = event.target && event.target.tagName === 'TEXTAREA';
      if (event.key === 'Enter' && (!inTextarea || event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    setTimeout(function () { clientInput.focus(); }, 0);
    return row;
  }

  function sorted() {
    var rows = accounts.map(function (account, index) { return { account: account, number: index + 1 }; });
    if (!sortKey) return rows;
    var dir = sortDir === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      if (sortKey === 'number') return (a.number - b.number) * dir;
      var x = String(a.account[sortKey] || '').toLowerCase();
      var y = String(b.account[sortKey] || '').toLowerCase();
      if (x === y) return a.number - b.number;
      if (!x) return 1;   // empty values always last
      if (!y) return -1;
      return x.localeCompare(y) * dir;
    });
    return rows;
  }

  function render() {
    body.innerHTML = '';
    sorted().forEach(function (row) {
      body.appendChild(row.account.id === editingId ? editRow(row.account, row.number) : viewRow(row.account, row.number));
    });
    if (draft) body.appendChild(editRow(draft, accounts.length + 1));
    sortButtons.forEach(function (btn) {
      var active = btn.dataset.sort === sortKey;
      btn.classList.toggle('is-asc', active && sortDir === 'asc');
      btn.classList.toggle('is-desc', active && sortDir === 'desc');
    });
    empty.hidden = accounts.length > 0 || !!draft;
    addButton.disabled = !connected || editingId !== null;
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
    draft = { id: 'new', client: '', company: '', link: '' };
    editingId = 'new';
    render();
  });

  render();
  load();
  // Pick up other people's changes; pause while a row is being edited.
  setInterval(function () { if (editingId === null && !document.hidden) load(); }, POLL_MS);
})();
