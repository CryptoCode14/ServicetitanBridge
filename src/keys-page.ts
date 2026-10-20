/**
 * The /keys admin page (served by api/keys.ts). Single static page, vanilla
 * JS, no build step. The human owner signs in with a username/password
 * admin account (one-time setup via /v1/admin/setup); the session is an
 * HttpOnly signed cookie, so no API key ever touches this page. Agents keep
 * using API keys exactly as before.
 */
export const KEYS_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ServiceTitan Bridge — API Keys</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f6f7f9; color: #1c2333; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #5b6478; font-size: 14px; margin: 0 0 24px; }
  .card { background: #fff; border: 1px solid #e2e6ee; border-radius: 10px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
  .card h2 { font-size: 16px; margin: 0 0 12px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
  input[type="text"], input[type="password"], select { width: 100%; padding: 10px 12px; border: 1px solid #c9d1e0; border-radius: 8px; font-size: 14px; background: #fff; }
  button { appearance: none; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; background: #175cd3; color: #fff; }
  button:hover { background: #124aab; }
  button.secondary { background: #eef1f6; color: #1c2333; }
  button.secondary:hover { background: #e0e6f0; }
  button.danger { background: #b42318; }
  button.danger:hover { background: #932012; }
  button.small { padding: 6px 10px; font-size: 13px; }
  button:disabled { opacity: .55; cursor: default; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #edf0f5; vertical-align: middle; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #5b6478; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.full { background: #fef0c7; color: #93370d; }
  .badge.restricted { background: #e0eaff; color: #175cd3; }
  .badge.on { background: #d1fadf; color: #027a48; }
  .badge.off { background: #f2f4f7; color: #667085; }
  .muted { color: #5b6478; font-size: 13px; }
  .error { background: #fef3f2; border: 1px solid #fecdca; color: #7a271a; border-radius: 8px; padding: 12px; font-size: 14px; margin-bottom: 16px; display: none; }
  .newkey { background: #fffaeb; border: 1px solid #fedf89; border-radius: 8px; padding: 16px; margin-top: 16px; display: none; }
  .newkey code { display: block; background: #fff; border: 1px solid #e2e6ee; border-radius: 8px; padding: 12px; font-size: 14px; word-break: break-all; margin: 10px 0; }
  .row { display: flex; gap: 10px; align-items: end; }
  .row > div { flex: 1; }
  .row button { white-space: nowrap; }
  .hidden { display: none; }
  .topbar { display: flex; justify-content: space-between; align-items: center; }
  .who { display: flex; gap: 10px; align-items: center; }
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div>
      <h1>ServiceTitan Bridge — API Keys</h1>
      <p class="sub">Create, list, and revoke API keys for AI agents and integrations.</p>
    </div>
    <div class="who">
      <span id="whoText" class="muted hidden"></span>
      <button id="logoutBtn" class="secondary small hidden">Log out</button>
    </div>
  </div>

  <div id="errorBox" class="error"></div>

  <div id="loadingCard" class="card">
    <p class="muted" style="margin:0">Checking sign-in status...</p>
  </div>

  <div id="notConnectedCard" class="card hidden">
    <h2>Key store not connected yet</h2>
    <p class="muted">The bridge's writable key store is not connected, so sign-in and key management are unavailable. In Vercel: open the servicetitanbridge project, go to the Storage tab, create a KV (Upstash) database and connect it to this project, then redeploy. This page will work as soon as that lands.</p>
  </div>

  <div id="setupCard" class="card hidden">
    <h2>Create your admin account</h2>
    <p class="muted">One-time setup. This account is how you sign in here to manage API keys — no API key needed. Your password is stored only as a secure hash and can never be shown again, so keep it somewhere safe.</p>
    <label for="setupUsername">Username</label>
    <input type="text" id="setupUsername" autocomplete="username" maxlength="50">
    <label for="setupPassword">Password (at least 10 characters)</label>
    <input type="password" id="setupPassword" autocomplete="new-password">
    <label for="setupPasswordConfirm">Confirm password</label>
    <input type="password" id="setupPasswordConfirm" autocomplete="new-password">
    <div style="margin-top:14px"><button id="setupBtn">Create admin account</button></div>
  </div>

  <div id="loginCard" class="card hidden">
    <h2>Sign in</h2>
    <p class="muted">Sign in with your admin account to manage API keys.</p>
    <label for="loginUsername">Username</label>
    <input type="text" id="loginUsername" autocomplete="username">
    <label for="loginPassword">Password</label>
    <input type="password" id="loginPassword" autocomplete="current-password">
    <div style="margin-top:14px"><button id="loginBtn">Sign in</button></div>
  </div>

  <div id="main" class="hidden">
    <div class="card">
      <h2>New key</h2>
      <div class="row">
        <div>
          <label for="newName">Name (who or what is this key for?)</label>
          <input type="text" id="newName" maxlength="100" placeholder="e.g. Second AI agent">
        </div>
        <div style="flex:0 0 190px">
          <label for="newScope">Access</label>
          <select id="newScope">
            <option value="restricted" selected>Restricted (read-only)</option>
            <option value="full">Full (read + write)</option>
          </select>
        </div>
        <button id="createBtn">Create key</button>
      </div>
      <p class="muted">Restricted keys can read allowed ServiceTitan data only. Full keys can also write. Start restricted; promote only when needed.</p>
      <div id="newKeyBox" class="newkey">
        <strong>New key created — copy it now.</strong>
        <p class="muted" style="margin:6px 0 0">You will not be able to see this key again. If you lose it, revoke it and create a new one.</p>
        <code id="newKeyValue"></code>
        <button id="copyBtn" class="secondary small">Copy key</button>
      </div>
    </div>

    <div class="card">
      <h2>Existing keys</h2>
      <table>
        <thead><tr><th>Name</th><th>Access</th><th>Status</th><th>Source</th><th></th></tr></thead>
        <tbody id="keysBody"><tr><td colspan="5" class="muted">Loading...</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<script>
(function () {
  var els = {
    error: document.getElementById('errorBox'),
    loading: document.getElementById('loadingCard'),
    notConnected: document.getElementById('notConnectedCard'),
    setupCard: document.getElementById('setupCard'),
    loginCard: document.getElementById('loginCard'),
    main: document.getElementById('main'),
    logout: document.getElementById('logoutBtn'),
    who: document.getElementById('whoText'),
    keysBody: document.getElementById('keysBody'),
    newKeyBox: document.getElementById('newKeyBox'),
    newKeyValue: document.getElementById('newKeyValue')
  };

  function showError(msg) {
    els.error.textContent = msg;
    els.error.style.display = msg ? 'block' : 'none';
  }

  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        if (!resp.ok) {
          var err = new Error(data.message || data.error || ('Request failed (' + resp.status + ')'));
          err.status = resp.status;
          err.code = data.error;
          throw err;
        }
        return data;
      });
    });
  }

  function badge(text, cls) { return '<span class="badge ' + cls + '">' + text + '</span>'; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showOnly(card) {
    [els.loading, els.notConnected, els.setupCard, els.loginCard, els.main].forEach(function (c) {
      c.classList.toggle('hidden', c !== card);
    });
    var authed = card === els.main;
    els.logout.classList.toggle('hidden', !authed);
    els.who.classList.toggle('hidden', !authed);
  }

  function renderKeys(keys) {
    if (!keys.length) {
      els.keysBody.innerHTML = '<tr><td colspan="5" class="muted">No keys found.</td></tr>';
      return;
    }
    els.keysBody.innerHTML = keys.map(function (k) {
      var action = k.enabled
        ? '<button class="danger small" data-revoke="' + escapeHtml(k.keyId) + '">Revoke</button>'
        : '';
      return '<tr><td>' + escapeHtml(k.name) + '</td>' +
        '<td>' + badge(k.scope === 'full' ? 'Full' : 'Restricted', k.scope) + '</td>' +
        '<td>' + (k.enabled ? badge('Enabled', 'on') : badge('Revoked', 'off')) + '</td>' +
        '<td class="muted">' + (k.source === 'page' ? 'This page' : 'Server config') + '</td>' +
        '<td style="text-align:right">' + action + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(els.keysBody.querySelectorAll('[data-revoke]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-revoke');
        if (!confirm('Revoke this key? Anything using it stops working immediately.')) return;
        btn.disabled = true;
        api('POST', '/v1/admin/keys/' + encodeURIComponent(id) + '/revoke')
          .then(loadKeys)
          .catch(function (e) {
            if (e.status === 401) { refreshState(); }
            showError(e.message); btn.disabled = false;
          });
      });
    });
  }

  function loadKeys() {
    return api('GET', '/v1/admin/keys').then(function (data) { renderKeys(data.keys || []); });
  }

  function refreshState() {
    showOnly(els.loading);
    return api('GET', '/v1/admin/session').then(function (state) {
      showError('');
      if (state.needsSetup) {
        showOnly(els.setupCard);
      } else if (!state.authenticated) {
        showOnly(els.loginCard);
      } else {
        els.who.textContent = state.username ? ('Signed in as ' + state.username) : '';
        showOnly(els.main);
        loadKeys().catch(function (e) { showError(e.message); });
      }
    }).catch(function (e) {
      if (e.status === 503) {
        showOnly(els.notConnected);
      } else {
        showOnly(els.loginCard);
        showError('Something went wrong checking sign-in status. Reload to try again.');
      }
    });
  }

  document.getElementById('setupBtn').addEventListener('click', function () {
    var username = document.getElementById('setupUsername').value.trim();
    var password = document.getElementById('setupPassword').value;
    var confirm = document.getElementById('setupPasswordConfirm').value;
    if (username.length < 3) { showError('Choose a username of at least 3 characters.'); return; }
    if (password.length < 10) { showError('Password must be at least 10 characters.'); return; }
    if (password !== confirm) { showError('Passwords do not match.'); return; }
    showError('');
    var btn = this;
    btn.disabled = true;
    api('POST', '/v1/admin/setup', { username: username, password: password }).then(function () {
      btn.disabled = false;
      refreshState();
    }).catch(function (e) {
      btn.disabled = false;
      if (e.status === 503) { showOnly(els.notConnected); return; }
      showError(e.message);
      if (e.status === 409) refreshState();
    });
  });

  document.getElementById('loginBtn').addEventListener('click', function () {
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!username || !password) { showError('Enter your username and password.'); return; }
    showError('');
    var btn = this;
    btn.disabled = true;
    api('POST', '/v1/admin/login', { username: username, password: password }).then(function () {
      btn.disabled = false;
      document.getElementById('loginPassword').value = '';
      refreshState();
    }).catch(function (e) {
      btn.disabled = false;
      if (e.status === 503) { showOnly(els.notConnected); return; }
      showError(e.status === 401 ? 'Incorrect username or password.' : e.message);
    });
  });

  els.logout.addEventListener('click', function () {
    api('POST', '/v1/admin/logout').catch(function () {}).then(function () {
      els.who.textContent = '';
      refreshState();
    });
  });

  document.getElementById('createBtn').addEventListener('click', function () {
    var name = document.getElementById('newName').value.trim();
    var scope = document.getElementById('newScope').value;
    if (!name) { showError('Give the new key a name first.'); return; }
    showError('');
    els.newKeyBox.style.display = 'none';
    api('POST', '/v1/admin/keys', { name: name, scope: scope }).then(function (data) {
      els.newKeyValue.textContent = data.apiKey;
      els.newKeyBox.style.display = 'block';
      document.getElementById('newName').value = '';
      loadKeys();
    }).catch(function (e) {
      if (e.status === 401) { refreshState(); }
      showError(e.message);
    });
  });

  document.getElementById('copyBtn').addEventListener('click', function () {
    var text = els.newKeyValue.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      this.textContent = 'Copied';
      var btn = this;
      setTimeout(function () { btn.textContent = 'Copy key'; }, 1500);
    }
  });

  refreshState();
})();
</script>
</body>
</html>
`;
