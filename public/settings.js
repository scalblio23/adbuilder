// Ad Accounts: "Refresh from Hermes" pulls accounts through the Hermes agent.
(function () {
  var refreshButton = document.getElementById('refreshAccounts');
  if (!refreshButton) return;
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
})();
