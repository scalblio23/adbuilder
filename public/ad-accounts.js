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
      if (!connected) { connected = true; setNotice('ok', 'Connected. Everyone who opens this site sees the same accounts.'); }
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

  function viewRow(account) {
    var linkCell = el('td');
    if (account.link) linkCell.appendChild(el('a', { 'class': 'link', href: account.link, target: '_blank', rel: 'noopener', text: account.link }));
    else linkCell.appendChild(el('span', { 'class': 'muted', text: '—' }));
    return el('tr', {}, [
      el('td', { text: account.client }),
      el('td', { text: account.company }),
      linkCell,
      el('td', {}, [el('div', { 'class': 'table__actions' }, [
        button('Edit', '', function () { editingId = account.id; render(); }),
        button('Delete', 'btn--danger', function () {
          if (!confirm('Delete the ad account for ' + (account.client || 'this client') + '?')) return;
          request('DELETE', API + '/' + account.id).then(load, failed('delete the account'));
        })
      ])])
    ]);
  }

  function editRow(account) {
    var isNew = account.id === 'new';
    var clientInput = input('client', account.client, 'Client name');
    var companyInput = input('company', account.company, 'Company name');
    var linkInput = input('link', account.link, 'https://');

    function commit() {
      var client = clientInput.value.trim();
      clientInput.classList.toggle('is-invalid', !client);
      if (!client) { clientInput.focus(); return; }
      var data = { client: client, company: companyInput.value.trim(), link: linkInput.value.trim() };
      var write = isNew ? request('POST', API, data) : request('PUT', API + '/' + account.id, data);
      editingId = null; draft = null;
      write.then(load, failed('save the account'));
    }
    function cancel() { editingId = null; draft = null; render(); }

    var row = el('tr', { 'class': 'is-editing' }, [
      el('td', {}, [clientInput]),
      el('td', {}, [companyInput]),
      el('td', {}, [linkInput]),
      el('td', {}, [el('div', { 'class': 'table__actions' }, [
        button('Save', 'btn--primary', commit),
        button('Cancel', '', cancel)
      ])])
    ]);
    row.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    setTimeout(function () { clientInput.focus(); }, 0);
    return row;
  }

  function render() {
    body.innerHTML = '';
    accounts.forEach(function (account) {
      body.appendChild(account.id === editingId ? editRow(account) : viewRow(account));
    });
    if (draft) body.appendChild(editRow(draft));
    empty.hidden = accounts.length > 0 || !!draft;
    addButton.disabled = !connected || editingId !== null;
  }

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
