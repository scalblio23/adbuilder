(function () {
  var STORAGE_KEY = 'adbuilder.adAccounts';
  var DEFAULTS = [
    { client: 'Jane Doe', company: 'Acme Corp', link: 'https://business.facebook.com/adsmanager/manage/campaigns?act=1000000000001' },
    { client: 'Sam Lee', company: 'Northwind Traders', link: 'https://business.facebook.com/adsmanager/manage/campaigns?act=1000000000002' },
    { client: 'Priya Patel', company: 'Globex Inc', link: 'https://business.facebook.com/adsmanager/manage/campaigns?act=1000000000003' }
  ];

  var body = document.getElementById('accountsBody');
  var empty = document.getElementById('accountsEmpty');
  var addButton = document.getElementById('addAccount');
  var accounts = load();
  var editingIndex = -1;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt or unavailable storage */ }
    return DEFAULTS.slice();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts)); } catch (e) { /* storage unavailable */ }
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

  function viewRow(account, index) {
    var linkCell = el('td');
    if (account.link) {
      linkCell.appendChild(el('a', { 'class': 'link', href: account.link, target: '_blank', rel: 'noopener', text: account.link }));
    } else {
      linkCell.appendChild(el('span', { 'class': 'muted', text: '—' }));
    }
    return el('tr', {}, [
      el('td', { text: account.client }),
      el('td', { text: account.company }),
      linkCell,
      el('td', {}, [
        el('div', { 'class': 'table__actions' }, [
          button('Edit', '', function () { editingIndex = index; render(); }),
          button('Delete', 'btn--danger', function () {
            if (confirm('Delete the ad account for ' + (account.client || 'this client') + '?')) {
              accounts.splice(index, 1);
              save();
              render();
            }
          })
        ])
      ])
    ]);
  }

  function editRow(account, index) {
    var clientInput = input('client', account.client, 'Client name');
    var companyInput = input('company', account.company, 'Company name');
    var linkInput = input('link', account.link, 'https://…');

    function commit() {
      var client = clientInput.value.trim();
      var company = companyInput.value.trim();
      var link = linkInput.value.trim();
      clientInput.classList.toggle('is-invalid', !client);
      if (!client) { clientInput.focus(); return; }
      if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
      accounts[index] = { client: client, company: company, link: link };
      editingIndex = -1;
      save();
      render();
    }

    function cancel() {
      if (account.isNew) accounts.splice(index, 1);
      editingIndex = -1;
      render();
    }

    var row = el('tr', { 'class': 'is-editing' }, [
      el('td', {}, [clientInput]),
      el('td', {}, [companyInput]),
      el('td', {}, [linkInput]),
      el('td', {}, [
        el('div', { 'class': 'table__actions' }, [
          button('Save', 'btn--primary', commit),
          button('Cancel', '', cancel)
        ])
      ])
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
    accounts.forEach(function (account, index) {
      body.appendChild(index === editingIndex ? editRow(account, index) : viewRow(account, index));
    });
    empty.hidden = accounts.length > 0;
    addButton.disabled = editingIndex !== -1;
  }

  addButton.addEventListener('click', function () {
    accounts.push({ client: '', company: '', link: '', isNew: true });
    editingIndex = accounts.length - 1;
    render();
  });

  render();
})();
