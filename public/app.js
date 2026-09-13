const ROLE_RANK = { super_hide_owner: 4, owner: 3, admin: 2, reseller: 1 };
let ME = null;

async function boot() {
  const r = await fetch('/api/auth/me');
  if (!r.ok) return location.href = '/login.html';
  ME = (await r.json()).user;

  document.getElementById('roleBadge').textContent = ME.role.replace(/_/g, ' ');
  document.getElementById('roleBadge').className = 'badge role-' + ME.role;
  document.getElementById('balanceVal').textContent = ME.balance;

  applyRoleVisibility();
  bindNav();
  showView('overview');
}

function applyRoleVisibility() {
  const rank = ROLE_RANK[ME.role];
  document.querySelectorAll('.nav-item').forEach(el => {
    const min = el.dataset.minRole || 'reseller';
    if (rank < ROLE_RANK[min]) el.hidden = true;
  });
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showView(btn.dataset.view);
    };
  });
  document.getElementById('burger').onclick = () =>
    document.getElementById('sidebar').classList.toggle('collapsed');
  document.getElementById('logoutBtn').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  };
}

const views = {
  overview: renderOverview,
  keys: renderKeys,
  users: renderUsers,
  credits: renderCredits,
  audit: renderAudit,
  master: renderMaster,
  apikeys: renderApiKeys,
};

async function showView(name) {
  const fn = views[name] || (() => {});
  document.getElementById('main').innerHTML = '<div class="card">Loading…</div>';
  await fn(document.getElementById('main'));
}

async function renderOverview(el) {
  const { keys } = await fetch('/api/keys').then(r => r.json());
  const active = keys.filter(k => k.status === 'active').length;
  const used = keys.filter(k => k.status === 'used').length;

  el.innerHTML = `
    <h1>Welcome, ${ME.username}</h1>
    <p class="muted">Signed in as <b>${ME.role.replace(/_/g,' ')}</b></p>
    <div class="grid" style="margin-top:16px">
      <div class="stat"><div class="num">${ME.balance}</div><div class="lbl">credits</div></div>
      <div class="stat"><div class="num">${keys.length}</div><div class="lbl">total keys</div></div>
      <div class="stat"><div class="num">${active}</div><div class="lbl">active</div></div>
      <div class="stat"><div class="num">${used}</div><div class="lbl">in use</div></div>
    </div>
  `;
}

async function renderKeys(el) {
  const rank = ROLE_RANK[ME.role];
  const res = await fetch('/api/keys');
  const { keys, prefix } = await res.json();

  const canDelete = rank >= ROLE_RANK.admin;
  const canResetLink = rank >= ROLE_RANK.admin;
  const canMaster = rank >= ROLE_RANK.owner;

  el.innerHTML = `
    <div class="card">
      <h2>Generate keys</h2>
      <p class="muted">Global prefix: <code>${prefix}</code></p>
      <div class="grid" style="margin:12px 0">
        <label>Count<input id="genCount" type="number" min="1" max="${rank >= ROLE_RANK.admin ? 200 : 50}" value="1"></label>
        <label>Duration (days)<input id="genDays" type="number" min="1" max="3650" value="30"></label>
        <label>Cost per key<input id="genCost" type="number" min="0" value="1"></label>
      </div>
      <button class="primary" id="genBtn">Generate</button>
    </div>

    <div class="card">
      <h2>Your keys</h2>
      ${canMaster ? `
        <div class="row" style="margin-bottom:10px">
          <button class="ghost small" id="masterReset">Reset ALL keys</button>
          <button class="danger small" id="masterDelete">Delete ALL keys</button>
        </div>` : ''}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Key</th><th>Status</th><th>Device</th><th>Duration</th>
              <th>Owner</th><th>Created</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${keys.map(k => `
              <tr>
                <td><code>${k.key_value}</code></td>
                <td>${statusPill(k.status)}</td>
                <td>${k.device_id ? k.device_id.slice(0,10) + '…' : '<span class="muted">unbound</span>'}</td>
                <td>${k.duration_days}d</td>
                <td>${k.owner_name ?? '—'}</td>
                <td>${new Date(k.created_at*1000).toLocaleDateString()}</td>
                <td>
                  <button class="ghost small" data-reset="${k.id}">Reset</button>
                  ${canResetLink ? `<button class="ghost small" data-link="${k.id}">Reset link</button>` : ''}
                  ${canDelete ? `<button class="danger small" data-del="${k.id}">Delete</button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelector('#genBtn')?.addEventListener('click', async () => {
    const count = +el.querySelector('#genCount').value;
    const duration_days = +el.querySelector('#genDays').value;
    const cost = +el.querySelector('#genCost').value;
    const r = await fetch('/api/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, duration_days, cost }),
    });
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    if (typeof data.balance === 'number') {
      document.getElementById('balanceVal').textContent = data.balance;
      ME.balance = data.balance;
    }
    toast(`✓ Generated ${data.keys.length} key(s)`);
    renderKeys(el);
  });

  el.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const r = await fetch(`/api/keys/${b.dataset.reset}/reset`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    toast('✓ Key reset');
    renderKeys(el);
  });

  el.querySelectorAll('[data-link]').forEach(b => b.onclick = async () => {
    const r = await fetch(`/api/keys/${b.dataset.link}/reset-link`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    const url = location.origin + data.url;
    await navigator.clipboard?.writeText(url).catch(() => {});
    toast('✓ Reset link copied');
  });

  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this key permanently?')) return;
    const r = await fetch(`/api/keys/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted');
    renderKeys(el);
  });

  el.querySelector('#masterReset')?.addEventListener('click', async () => {
    if (!confirm('Reset EVERY key in the system?')) return;
    const r = await fetch('/api/keys/master/reset-all', { method: 'POST' });
    const data = await r.json();
    toast(`✓ Reset ${data.affected} keys`);
    renderKeys(el);
  });
  el.querySelector('#masterDelete')?.addEventListener('click', async () => {
    if (!confirm('DELETE every key? This cannot be undone.')) return;
    const r = await fetch('/api/keys/master/delete-all', { method: 'POST' });
    const data = await r.json();
    toast(`✓ Deleted ${data.affected} keys`);
    renderKeys(el);
  });
}

async function renderCredits(el) {
  const rank = ROLE_RANK[ME.role];
  const canTransfer = rank >= ROLE_RANK.admin;

  const me = await fetch('/api/auth/me').then(r => r.json());
  ME.balance = me.user.balance;
  document.getElementById('balanceVal').textContent = ME.balance;

  el.innerHTML = `
    <div class="card">
      <h2>Your balance</h2>
      <div class="stat" style="max-width:220px">
        <div class="num">💰 ${ME.balance}</div>
        <div class="lbl">credits available</div>
      </div>
    </div>
    ${canTransfer ? `
      <div class="card">
        <h2>Transfer credits</h2>
        <div class="grid">
          <label>Recipient<select id="txTo"></select></label>
          <label>Amount<input id="txAmt" type="number" min="1" value="1"></label>
        </div>
        <button class="primary" id="txBtn">Send</button>
      </div>` : ''}
  `;

  if (!canTransfer) return;

  const { users } = await fetch('/api/users').then(r => r.json());
  const sel = el.querySelector('#txTo');
  users.filter(u => u.id !== ME.id).forEach(u => {
    const o = document.createElement('option');
    o.value = u.id;
    o.textContent = `${u.username} (${u.role})`;
    sel.appendChild(o);
  });

  el.querySelector('#txBtn').onclick = async () => {
    const to_user_id = +sel.value;
    const amount = +el.querySelector('#txAmt').value;
    const r = await fetch('/api/credits/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_user_id, amount }),
    });
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    toast('✓ Transfer complete');
    renderCredits(el);
  };
}

async function renderUsers(el) {
  const { users } = await fetch('/api/users').then(r => r.json());
  const canCreate = ROLE_RANK[ME.role] >= ROLE_RANK.admin;
  const canDelete = ROLE_RANK[ME.role] >= ROLE_RANK.admin;

  el.innerHTML = `
    ${canCreate ? `
      <div class="card">
        <h2>Create user</h2>
        <div class="grid">
          <label>Username<input id="uName"></label>
          <label>Password<input id="uPass" type="password"></label>
          <label>Role
            <select id="uRole">
              <option value="reseller">reseller</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label>Starting balance<input id="uBal" type="number" value="0"></label>
        </div>
        <button class="primary" id="uBtn">Create</button>
      </div>` : ''}
    <div class="card">
      <h2>Users</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Balance</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${u.id}</td>
                <td>${u.username}</td>
                <td><span class="badge role-${u.role}">${u.role.replace(/_/g,' ')}</span></td>
                <td>${u.balance}</td>
                <td>${canDelete && u.id !== ME.id ? `<button class="danger small" data-del="${u.id}">Delete</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelector('#uBtn')?.addEventListener('click', async () => {
    const username = el.querySelector('#uName').value;
    const password = el.querySelector('#uPass').value;
    const role = el.querySelector('#uRole').value;
    const balance = +el.querySelector('#uBal').value;
    const r = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role, balance }),
    });
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    toast('✓ User created');
    renderUsers(el);
  });

  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this user?')) return;
    const r = await fetch(`/api/users/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted');
    renderUsers(el);
  });
}

async function renderAudit(el) {
  const { logs } = await fetch('/api/audit?limit=200').then(r => r.json());
  el.innerHTML = `
    <div class="card">
      <h2>Audit log</h2>
      <p class="muted">Super Hide Owner actions are not recorded here.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td>${new Date(l.created_at*1000).toLocaleString()}</td>
                <td>${l.actor_username} <span class="muted">(${l.actor_role})</span></td>
                <td><code>${l.action}</code></td>
                <td>${l.target ?? '—'}</td>
                <td>${l.ip ?? '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderMaster(el) {
  const { prefix } = await fetch('/api/keys').then(r => r.json());
  el.innerHTML = `
    <div class="card">
      <h2>Global prefix</h2>
      <p class="muted">Currently: <code>${prefix}</code></p>
      <div class="grid">
        <label>New prefix (2–10 uppercase A–Z, 0–9)<input id="pfx" maxlength="10"></label>
      </div>
      <button class="primary" id="pfxBtn">Save prefix</button>
    </div>
  `;
  el.querySelector('#pfxBtn').onclick = async () => {
    const prefix = el.querySelector('#pfx').value.trim().toUpperCase();
    const r = await fetch('/api/keys/prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    });
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    toast('✓ Prefix updated');
    renderMaster(el);
  };
}

async function renderApiKeys(el) {
  const r = await fetch('/api/apikeys');
  const { apiKeys } = await r.json();
  el.innerHTML = `
    <div class="card">
      <h2>API Keys</h2>
      <p class="muted">Used by external bots/sites to call <code>/api/external/*</code>.</p>
      <div class="grid" style="margin:12px 0">
        <label>Name<input id="akName" placeholder="MyBot"></label>
        <label>Scopes
          <select id="akScopes" multiple size="4">
            <option value="verify" selected>verify</option>
            <option value="keys:read">keys:read</option>
            <option value="keys:write">keys:write</option>
            <option value="credits">credits</option>
          </select>
        </label>
      </div>
      <button class="primary" id="akCreate">Create key</button>
      <div class="table-wrap" style="margin-top:16px">
        <table>
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Status</th><th>Last used</th><th></th></tr></thead>
          <tbody>${apiKeys.map(k => `
            <tr>
              <td>${k.name}</td>
              <td><code>${k.key_prefix}…</code></td>
              <td>${k.scopes}</td>
              <td>${k.active ? '✅ active' : '⛔ revoked'}</td>
              <td>${k.last_used ? new Date(k.last_used*1000).toLocaleString() : '—'}</td>
              <td>
                ${k.active ? `<button class="ghost small" data-revoke="${k.id}">Revoke</button>` : ''}
                <button class="danger small" data-del="${k.id}">Delete</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  el.querySelector('#akCreate').onclick = async () => {
    const name = el.querySelector('#akName').value.trim();
    const scopes = [...el.querySelector('#akScopes').selectedOptions].map(o => o.value);
    const res = await fetch('/api/apikeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });
    const data = await res.json();
    if (!res.ok) return toast('✗ ' + data.error);
    el.querySelector('#akCreate').insertAdjacentHTML('afterend',
      `<div class="card" style="margin-top:12px;background:#fffbeb;border-color:#fde68a">
         <b>Save this key now — it will not be shown again:</b>
         <div style="margin-top:6px"><code style="user-select:all">${data.key}</code></div>
       </div>`);
    renderApiKeys(el);
  };

  el.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
    await fetch(`/api/apikeys/${b.dataset.revoke}/revoke`, { method: 'POST' });
    renderApiKeys(el);
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this API key?')) return;
    await fetch(`/api/apikeys/${b.dataset.del}`, { method: 'DELETE' });
    renderApiKeys(el);
  });
}

function statusPill(s) {
  const map = {
    active: '<span class="badge role-reseller">active</span>',
    used: '<span class="badge role-admin">used</span>',
    revoked: '<span class="badge role-super_hide_owner">revoked</span>',
  };
  return map[s] || s;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

boot();
