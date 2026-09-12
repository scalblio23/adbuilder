// Settings tab: Hermes agent connection. Ad Accounts: "Refresh from Hermes".
(function () {
  var urlInput = document.getElementById('hermesUrl');
  var keyInput = document.getElementById('hermesKey');
  var saveButton = document.getElementById('saveHermes');
  var notice = document.getElementById('hermesNotice');
  var noticeText = document.getElementById('hermesNoticeText');
  var refreshButton = document.getElementById('refreshAccounts');

  function setNotice(kind, text) { notice.className = 'notice' + (kind ? ' notice--' + kind : ''); noticeText.textContent = text; }

  function show(cfg) {
    urlInput.value = cfg.hermesUrl || '';
    keyInput.placeholder = cfg.hermesKeyMasked ? 'Saved key ' + cfg.hermesKeyMasked + ' (paste a new one to replace)' : 'Paste the Hermes API key';
    if (cfg.hermesConfigured) setNotice('ok', 'Hermes is connected' + (cfg.source === 'env' ? ' (configured through environment variables on the host).' : '.'));
    else setNotice('', 'Hermes is not connected. Enter the URL and API key, then save.');
    var locked = cfg.source === 'env';
    urlInput.disabled = keyInput.disabled = saveButton.disabled = locked;
  }

  function load() {
    fetch('/api/settings', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(show).catch(function () {
      setNotice('error', 'Could not load settings from the server.');
    });
  }

  saveButton.addEventListener('click', function () {
    saveButton.disabled = true;
    fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hermesUrl: urlInput.value.trim(), hermesKey: keyInput.value.trim() }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Save failed'); return j; }); })
      .then(function (cfg) { keyInput.value = ''; show(cfg); setNotice('ok', cfg.hermesConfigured ? 'Saved. Hermes is connected.' : 'Saved. Add both the URL and key to connect.'); })
      .catch(function (err) { setNotice('error', 'Could not save: ' + err.message); })
      .then(function () { saveButton.disabled = false; });
  });

  if (refreshButton) {
    refreshButton.addEventListener('click', function () {
      var accountsNotice = document.getElementById('accountsNoticeText');
      var accountsBox = document.getElementById('accountsNotice');
      refreshButton.disabled = true;
      refreshButton.textContent = 'Refreshing…';
      fetch('/api/hermes/accounts', { method: 'POST' })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); })
        .then(function (res) {
          if (res.ok) { accountsBox.className = 'notice notice--ok'; accountsNotice.textContent = 'Pulled ' + res.body.pulled + ' accounts from Hermes, added ' + res.body.added + ' new.'; }
          else { accountsBox.className = 'notice notice--error'; accountsNotice.textContent = res.body.error || ('Hermes returned ' + res.status); }
        })
        .catch(function (err) { accountsBox.className = 'notice notice--error'; accountsNotice.textContent = 'Could not reach the server: ' + err.message; })
        .then(function () { refreshButton.disabled = false; refreshButton.textContent = 'Refresh from Hermes'; });
    });
  }

  load();
})();
