const ROLE_RANK = { super_hide_owner: 4, owner: 3, admin: 2, reseller: 1 };
let ME = null;

/* ---------- BOOT ---------- */
async function boot() {
  await loadBranding();
  const r = await fetch('/api/auth/me');
  if (!r.ok) return location.href = '/login.html';
  ME = (await r.json()).user;

  document.getElementById('balanceVal').textContent = ME.balance;
  document.getElementById('userName').textContent = ME.username;
  document.getElementById('userRole').textContent = ME.role.replace(/_/g, ' ');
  document.getElementById('userAvatar').textContent = ME.username.charAt(0).toUpperCase();

  applyRoleVisibility();
  bindNav();
  showView('overview');
}

async function loadBranding() {
  try {
    const r = await fetch('/api/branding');
    if (!r.ok) return;
    const b = await r.json();
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('brandLogo', b.brand_logo);
    set('brandName', b.brand_name);
    document.title = b.brand_name + ' — Dashboard';
    if (b.brand_color) document.documentElement.style.setProperty('--primary', b.brand_color);
  } catch {}
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
      if (window.innerWidth <= 720) document.getElementById('sidebar').classList.remove('open');
      showView(btn.dataset.view);
    };
  });
  document.getElementById('burger').onclick = () =>
    document.getElementById('sidebar').classList.toggle('open');
  const signout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  };
  document.getElementById('signOutBtn').onclick = signout;
  document.getElementById('logoutBtn').onclick = signout;
}

/* ---------- VIEW ROUTER ---------- */
const views = {
  overview: renderOverview,
  keys: renderKeys,
  licenses: renderKeys,
  users: renderUsers,
  credits: renderCredits,
  audit: renderAudit,
  master: renderMaster,
  apikeys: renderApiKeys,
  apidocs: renderApiDocs,
  settings: renderSettings,
  pricing: renderPricing,
};

async function showView(name) {
  const fn = views[name] || renderOverview;
  const main = document.getElementById('main');
  main.innerHTML = '<div class="card">Loading…</div>';
  try { await fn(main); }
  catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card"><h2>Error</h2><p class="muted">${e.message}</p></div>`;
  }
}

/* ---------- OVERVIEW ---------- */
async function renderOverview(el) {
  const { keys } = await fetch('/api/keys?per_page=200').then(r => r.json());
  const active = keys.filter(k => k.status === 'active' && !k.banned).length;
  const banned = keys.filter(k => k.banned).length;

  el.innerHTML = `
    <h1>Welcome back, ${ME.username}</h1>
    <p class="muted" style="margin-bottom:20px">Signed in as ${ME.role.replace(/_/g,' ')}</p>
    <div class="grid">
      <div class="stat"><div class="stat-icon">🔑</div>
        <div class="lbl">Total Licenses</div><div class="num">${keys.length}</div>
        <div class="desc">All time generated</div></div>
      <div class="stat"><div class="stat-icon">⚡</div>
        <div class="lbl">Active Keys</div><div class="num">${active}</div>
        <div class="desc"><span class="status-dot"></span> Currently running</div></div>
      <div class="stat"><div class="stat-icon">🚫</div>
        <div class="lbl">Banned</div><div class="num">${banned}</div>
        <div class="desc">Blocked licenses</div></div>
      <div class="stat"><div class="stat-icon">🪙</div>
        <div class="lbl">Balance</div><div class="num">${ME.balance}</div>
        <div class="desc">Available credits</div></div>
    </div>
  `;
}

/* ---------- GENERATE + LICENSE MANAGER ---------- */
let LICENSES_STATE = { page: 1, q: '', status: 'all' };

async function renderKeys(el) {
  const rank = ROLE_RANK[ME.role];
  const canDelete    = rank >= ROLE_RANK.admin;
  const canResetLink = rank >= ROLE_RANK.admin;
  const canBan       = rank >= ROLE_RANK.owner;
  const canMaster    = rank >= ROLE_RANK.owner;

  const pricingRes = await fetch('/api/pricing').then(r => r.json());
  const pricingList = pricingRes.pricing || [];
  const durations = [...new Set(pricingList.map(p => p.duration_days))].sort((a,b)=>a-b);

  el.innerHTML = `
    <h1>Generate Keys</h1>
    <p class="muted" style="margin-bottom:20px">Pick duration & device count — cost is calculated automatically</p>

    <div class="card">
      ${pricingList.length === 0 ? `
        <p class="muted">No pricing rules configured yet. Ask an Owner to set prices in <b>Pricing</b>.</p>
      ` : `
        <div class="grid">
          <label>Duration
            <select id="genDuration">
              ${durations.map(d => `<option value="${d}">${d} day${d>1?'s':''}</option>`).join('')}
            </select>
          </label>
          <label>Devices
            <select id="genTier">
              <option value="1">1 device</option>
              <option value="2">2 devices</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </label>
          <label>Quantity<input id="genCount" type="number" min="1" max="${rank >= ROLE_RANK.admin ? 200 : 50}" value="1"></label>
        </div>
        <div class="stat" style="margin-top:12px">
          <div class="lbl">Cost per key</div>
          <div class="num" id="costPerKey">—</div>
          <div class="desc">Total: <b id="costTotal">—</b> · Your balance: <b>${ME.balance}</b></div>
        </div>
        <button class="primary" id="genBtn" style="margin-top:12px">Generate Batch</button>
      `}
    </div>

    <div class="card">
      <h2>License Manager</h2>
      <div class="grid" style="margin-bottom:12px">
        <label>Search
          <input id="licSearch" placeholder="Key / Username / Device ID" value="${LICENSES_STATE.q}">
        </label>
        <label>Status
          <select id="licStatus">
            <option value="all"     ${LICENSES_STATE.status==='all'?'selected':''}>All</option>
            <option value="active"  ${LICENSES_STATE.status==='active'?'selected':''}>Active</option>
            <option value="used"    ${LICENSES_STATE.status==='used'?'selected':''}>Used</option>
            <option value="banned"  ${LICENSES_STATE.status==='banned'?'selected':''}>Banned</option>
            <option value="expired" ${LICENSES_STATE.status==='expired'?'selected':''}>Expired</option>
          </select>
        </label>
      </div>

      ${canMaster ? `
        <div class="row" style="margin-bottom:12px">
          <button class="ghost small" id="masterReset">Reset ALL</button>
          <button class="danger small" id="masterDelete">Delete ALL</button>
        </div>` : ''}

      <div id="licTable"><div class="card">Loading…</div></div>
    </div>
  `;

  if (pricingList.length) {
    const updateCost = () => {
      const d = +el.querySelector('#genDuration').value;
      const t = el.querySelector('#genTier').value;
      const q = +el.querySelector('#genCount').value || 1;
      const row = pricingList.find(p => p.duration_days === d && p.device_tier === t);
      const unit = row ? row.credit_cost : '—';
      el.querySelector('#costPerKey').textContent = unit === '—' ? '—' : unit + ' credits';
      el.querySelector('#costTotal').textContent = unit === '—' ? '—' : (unit * q) + ' credits';
    };
    el.querySelector('#genDuration').onchange = updateCost;
    el.querySelector('#genTier').onchange = updateCost;
    el.querySelector('#genCount').oninput = updateCost;
    updateCost();

    el.querySelector('#genBtn').onclick = async () => {
      const duration_days = +el.querySelector('#genDuration').value;
      const device_tier = el.querySelector('#genTier').value;
      const count = +el.querySelector('#genCount').value;
      const r = await fetch('/api/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count, duration_days, device_tier }),
      });
      const data = await r.json();
      if (!r.ok) return toast('✗ ' + data.error);
      if (typeof data.balance === 'number') {
        document.getElementById('balanceVal').textContent = data.balance;
        ME.balance = data.balance;
      }
      toast(`✓ Generated ${data.keys.length} key(s) — ${data.total_cost} credits`);
      renderKeys(el);
    };
  }

  const reloadTable = async () => {
    const wrap = el.querySelector('#licTable');
    wrap.innerHTML = '<div class="card">Loading…</div>';
    const res = await fetch(`/api/keys?page=${LICENSES_STATE.page}&per_page=20&q=${encodeURIComponent(LICENSES_STATE.q)}&status=${LICENSES_STATE.status}`);
    const data = await res.json();
    renderLicTable(wrap, data, { canDelete, canResetLink, canBan, canMaster }, el);
  };

  el.querySelector('#licSearch').oninput = (e) => {
    LICENSES_STATE.q = e.target.value;
    LICENSES_STATE.page = 1;
    clearTimeout(el._searchTimer);
    el._searchTimer = setTimeout(reloadTable, 350);
  };
  el.querySelector('#licStatus').onchange = (e) => {
    LICENSES_STATE.status = e.target.value;
    LICENSES_STATE.page = 1;
    reloadTable();
  };

  await reloadTable();

  el.querySelector('#masterReset')?.addEventListener('click', async () => {
    if (!confirm('Reset EVERY key?')) return;
    const r = await fetch('/api/keys/master/reset-all', { method: 'POST' });
    const d = await r.json();
    toast(`✓ Reset ${d.affected} keys`);
    renderKeys(el);
  });
  el.querySelector('#masterDelete')?.addEventListener('click', async () => {
    if (!confirm('DELETE every key?')) return;
    const r = await fetch('/api/keys/master/delete-all', { method: 'POST' });
    const d = await r.json();
    toast(`✓ Deleted ${d.affected} keys`);
    renderKeys(el);
  });
}

function renderLicTable(wrap, data, perms, rootEl) {
  const { keys, pagination } = data;
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Key</th><th>Status</th><th>Devices</th><th>Duration</th>
              <th>Owner</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${keys.length === 0 ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No keys found</td></tr>` : ''}
          ${keys.map(k => {
            let pill;
            if (k.banned) pill = '<span class="badge danger">banned</span>';
            else if (k.status === 'used') pill = '<span class="badge warn">used</span>';
            else pill = '<span class="badge ok">active</span>';
            const tierLabel = k.device_tier === 'unlimited' ? 'unlimited' : k.device_tier + ' device';
            return `
              <tr>
                <td><code>${k.key_value}</code></td>
                <td>${pill}</td>
                <td>${k.device_count || 0} / ${tierLabel}</td>
                <td>${k.duration_days}d</td>
                <td>${k.owner_name ?? '—'}</td>
                <td>${new Date(k.created_at*1000).toLocaleDateString()}</td>
                <td>
                  <button class="ghost small" data-details="${k.id}" title="Details">👁️</button>
                  ${perms.canBan ? (k.banned
                    ? `<button class="ghost small" data-unban="${k.id}" title="Unban">↩️</button>`
                    : `<button class="ghost small" data-ban="${k.id}" title="Ban">🚫</button>`) : ''}
                  ${perms.canResetLink ? `<button class="ghost small" data-link="${k.id}" title="Reset link">🔗</button>` : ''}
                  ${perms.canDelete ? `<button class="danger small" data-del="${k.id}" title="Delete">🗑️</button>` : ''}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="row" style="margin-top:12px;justify-content:space-between">
      <span class="muted">Page ${pagination.page} of ${pagination.total_pages} · ${pagination.total} total</span>
      <div class="row">
        <button class="ghost small" id="pgPrev" ${pagination.page<=1?'disabled':''}>← Previous</button>
        <button class="ghost small" id="pgNext" ${pagination.page>=pagination.total_pages?'disabled':''}>Next →</button>
      </div>
    </div>
  `;

  wrap.querySelector('#pgPrev')?.addEventListener('click', () => {
    if (LICENSES_STATE.page > 1) {
      LICENSES_STATE.page--;
      rootEl.querySelector('#licStatus').dispatchEvent(new Event('change'));
    }
  });
  wrap.querySelector('#pgNext')?.addEventListener('click', () => {
    if (LICENSES_STATE.page < pagination.total_pages) {
      LICENSES_STATE.page++;
      rootEl.querySelector('#licStatus').dispatchEvent(new Event('change'));
    }
  });

  wrap.querySelectorAll('[data-details]').forEach(b => b.onclick = () => openDetailsModal(+b.dataset.details, rootEl));
  wrap.querySelectorAll('[data-ban]').forEach(b => b.onclick = async () => {
    if (!confirm('Ban this key? Users will not be able to log in.')) return;
    const r = await fetch(`/api/keys/${b.dataset.ban}/ban`, { method: 'POST' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Key banned'); refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-unban]').forEach(b => b.onclick = async () => {
    const r = await fetch(`/api/keys/${b.dataset.unban}/unban`, { method: 'POST' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Key unbanned'); refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-link]').forEach(b => b.onclick = async () => {
    const r = await fetch(`/api/keys/${b.dataset.link}/reset-link`, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    await navigator.clipboard?.writeText(location.origin + d.url).catch(()=>{});
    toast('✓ Reset link copied');
  });
  wrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this key permanently?')) return;
    const r = await fetch(`/api/keys/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); refreshLic(rootEl);
  });
}

function refreshLic(rootEl) {
  rootEl.querySelector('#licStatus').dispatchEvent(new Event('change'));
}

async function openDetailsModal(id, rootEl) {
  const r = await fetch(`/api/keys/${id}/details`);
  const data = await r.json();
  if (!r.ok) return toast('✗ ' + data.error);
  const k = data.key;
  const devices = data.devices || [];

  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.75);
    display:grid;place-items:center;z-index:200;padding:20px`;
  overlay.innerHTML = `
    <div class="card" style="max-width:520px;width:100%;max-height:85vh;overflow-y:auto">
      <div class="row" style="justify-content:space-between;margin-bottom:14px">
        <h2 style="margin:0">License Details</h2>
        <button class="icon-btn" id="closeModal">✕</button>
      </div>

      <div class="row" style="gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${k.banned ? '<span class="badge danger">banned</span>' : `<span class="badge ${k.status==='used'?'warn':'ok'}">${k.status}</span>`}
        <span class="badge role-admin">${k.device_tier === 'unlimited' ? 'unlimited' : k.device_tier + ' device'}</span>
        <span class="badge">${k.duration_days} days</span>
      </div>

      <label>Key
        <input value="${k.key_value}" readonly style="font-family:monospace">
      </label>

      <div class="grid" style="grid-template-columns:1fr 1fr">
        <div class="stat"><div class="lbl">Owner</div><div class="desc" style="font-size:14px;color:var(--text)">${k.owner_name || '—'}</div></div>
        <div class="stat"><div class="lbl">Created by</div><div class="desc" style="font-size:14px;color:var(--text)">${k.creator_name || '—'}</div></div>
        <div class="stat"><div class="lbl">Created</div><div class="desc" style="font-size:14px;color:var(--text)">${new Date(k.created_at*1000).toLocaleString()}</div></div>
        <div class="stat"><div class="lbl">Expires</div><div class="desc" style="font-size:14px;color:var(--text)">${
          k.used_at ? new Date((k.used_at + k.duration_days*86400)*1000).toLocaleString()
          : new Date((k.created_at + k.duration_days*86400)*1000).toLocaleString() + ' (from activation)'
        }</div></div>
      </div>

      <h2 style="margin-top:20px;font-size:14px">Devices (${devices.length})</h2>
      ${devices.length === 0 ? '<p class="muted">No devices bound yet.</p>' : `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Device ID</th><th>First seen</th><th>Last seen</th></tr></thead>
            <tbody>
              ${devices.map(d => `
                <tr>
                  <td><code>${d.device_id}</code></td>
                  <td>${new Date(d.first_seen*1000).toLocaleString()}</td>
                  <td>${new Date(d.last_seen*1000).toLocaleString()}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#closeModal').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

/* ---------- PRICING (Owner+) ---------- */
async function renderPricing(el) {
  const { pricing } = await fetch('/api/pricing').then(r => r.json());
  el.innerHTML = `
    <h1>Pricing Configuration</h1>
    <p class="muted" style="margin-bottom:20px">Owner-only. Sets how many credits each key costs.</p>

    <div class="card">
      <h2>Add / Update Rule</h2>
      <div class="grid">
        <label>Duration (days)<input id="pDays" type="number" min="1" max="3650" placeholder="30"></label>
        <label>Devices
          <select id="pTier">
            <option value="1">1 device</option>
            <option value="2">2 devices</option>
            <option value="unlimited">Unlimited</option>
          </select>
        </label>
        <label>Credit cost<input id="pCost" type="number" min="0" placeholder="5"></label>
      </div>
      <button class="primary" id="pAdd" style="margin-top:8px">Save Rule</button>
    </div>

    <div class="card">
      <h2>Current Rules (${pricing.length})</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Duration</th><th>Devices</th><th>Cost</th><th></th></tr></thead>
          <tbody>
            ${pricing.length === 0 ? '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No pricing rules yet</td></tr>' :
              pricing.map(p => `
                <tr>
                  <td>${p.duration_days} day${p.duration_days>1?'s':''}</td>
                  <td>${p.device_tier === 'unlimited' ? 'Unlimited' : p.device_tier + ' device'}</td>
                  <td><b>${p.credit_cost}</b> cr</td>
                  <td>
                    <button class="ghost small" data-edit="${p.id}" data-cost="${p.credit_cost}">Edit</button>
                    <button class="danger small" data-del="${p.id}">Delete</button>
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  el.querySelector('#pAdd').onclick = async () => {
    const duration_days = +el.querySelector('#pDays').value;
    const device_tier = el.querySelector('#pTier').value;
    const credit_cost = +el.querySelector('#pCost').value;
    const r = await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_days, device_tier, credit_cost }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Rule saved');
    renderPricing(el);
  };

  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this pricing rule?')) return;
    const r = await fetch(`/api/pricing/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); renderPricing(el);
  });

  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const cost = prompt('New credit cost:', b.dataset.cost);
    if (cost === null) return;
    const r = await fetch(`/api/pricing/${b.dataset.edit}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credit_cost: +cost }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Updated'); renderPricing(el);
  });
}

/* ---------- CREDITS ---------- */
async function renderCredits(el) {
  const rank = ROLE_RANK[ME.role];
  const canTransfer = rank >= ROLE_RANK.admin;
  const me = await fetch('/api/auth/me').then(r => r.json());
  ME.balance = me.user.balance;
  document.getElementById('balanceVal').textContent = ME.balance;

  el.innerHTML = `
    <h1>Credits</h1>
    <p class="muted" style="margin-bottom:20px">Your available balance</p>
    <div class="grid">
      <div class="stat"><div class="stat-icon">🪙</div>
        <div class="lbl">Balance</div><div class="num">${ME.balance}</div>
        <div class="desc">credits available</div></div>
    </div>
    ${canTransfer ? `
      <div class="card" style="margin-top:16px">
        <h2>Transfer Credits</h2>
        <div class="grid">
          <label>Recipient<select id="txTo"></select></label>
          <label>Amount<input id="txAmt" type="number" min="1" value="1"></label>
        </div>
        <button class="primary" id="txBtn" style="margin-top:8px">Send</button>
      </div>` : ''}
  `;
  if (!canTransfer) return;
  const { users } = await fetch('/api/users').then(r => r.json());
  const sel = el.querySelector('#txTo');
  users.filter(u => u.id !== ME.id).forEach(u => {
    const o = document.createElement('option');
    o.value = u.id; o.textContent = `${u.username} (${u.role})`;
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
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Transfer complete'); renderCredits(el);
  };
}

/* ---------- USERS ---------- */
async function renderUsers(el) {
  const { users } = await fetch('/api/users').then(r => r.json());
  const canCreate = ROLE_RANK[ME.role] >= ROLE_RANK.admin;
  const canDelete = ROLE_RANK[ME.role] >= ROLE_RANK.admin;

  el.innerHTML = `
    <h1>Users</h1>
    <p class="muted" style="margin-bottom:20px">Manage accounts below your role</p>
    ${canCreate ? `
      <div class="card">
        <h2>Create User</h2>
        <div class="grid">
          <label>Username<input id="uName"></label>
          <label>Password<input id="uPass" type="password"></label>
          <label>Role<select id="uRole">
            <option value="reseller">Reseller</option>
            <option value="admin">Admin</option>
          </select></label>
          <label>Starting Balance<input id="uBal" type="number" value="0"></label>
        </div>
        <button class="primary" id="uBtn" style="margin-top:8px">Create User</button>
      </div>` : ''}
    <div class="card">
      <h2>All Users</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Balance</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${u.id}</td><td>${u.username}</td>
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
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ User created'); renderUsers(el);
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this user?')) return;
    const r = await fetch(`/api/users/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); renderUsers(el);
  });
}

/* ---------- AUDIT ---------- */
async function renderAudit(el) {
  const { logs } = await fetch('/api/audit?limit=200').then(r => r.json());
  el.innerHTML = `
    <h1>Audit Log</h1>
    <p class="muted" style="margin-bottom:20px">Super Hide Owner actions are invisible here.</p>
    <div class="card">
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

/* ---------- MASTER ---------- */
async function renderMaster(el) {
  const { prefix } = await fetch('/api/keys').then(r => r.json());
  el.innerHTML = `
    <h1>Master Controls</h1>
    <p class="muted" style="margin-bottom:20px">Owner-only settings</p>
    <div class="card">
      <h2>Global Prefix</h2>
      <p class="muted">Currently: <code>${prefix}</code></p>
      <div style="max-width:320px;margin-top:12px">
        <label>New prefix (2–10 uppercase A–Z, 0–9)
          <input id="pfx" maxlength="10" value="${prefix}"></label>
        <button class="primary" id="pfxBtn">Save Prefix</button>
      </div>
    </div>
  `;
  el.querySelector('#pfxBtn').onclick = async () => {
    const prefix = el.querySelector('#pfx').value.trim().toUpperCase();
    const r = await fetch('/api/keys/prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Prefix updated'); renderMaster(el);
  };
}

/* ---------- API KEYS ---------- */
async function renderApiKeys(el) {
  const { apiKeys } = await fetch('/api/apikeys').then(r => r.json());
  el.innerHTML = `
    <h1>API Keys</h1>
    <p class="muted" style="margin-bottom:20px">Used by external bots/sites</p>
    <div class="card">
      <h2>Create API Key</h2>
      <div class="grid">
        <label>Name<input id="akName" placeholder="MyBot"></label>
        <label>Scopes
          <select id="akScopes" multiple size="3">
            <option value="verify" selected>verify</option>
            <option value="keys:read">keys:read</option>
            <option value="keys:write">keys:write</option>
            <option value="credits">credits</option>
          </select>
        </label>
      </div>
      <button class="primary" id="akCreate" style="margin-top:8px">Create Key</button>
    </div>
    <div class="card">
      <h2>Your Keys</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Status</th><th></th></tr></thead>
          <tbody>${apiKeys.map(k => `
            <tr>
              <td>${k.name}</td>
              <td><code>${k.key_prefix}…</code></td>
              <td>${k.scopes}</td>
              <td>${k.active ? '<span class="badge ok">active</span>' : '<span class="badge danger">revoked</span>'}</td>
              <td>
                ${k.active ? `<button class="ghost small" data-revoke="${k.id}">Revoke</button>` : ''}
                <button class="danger small" data-del="${k.id}">Del</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  el.querySelector('#akCreate').onclick = async () => {
    const name = el.querySelector('#akName').value.trim();
    const scopes = [...el.querySelector('#akScopes').selectedOptions].map(o => o.value);
    const res = await fetch('/api/apikeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });
    const d = await res.json();
    if (!res.ok) return toast('✗ ' + d.error);
    el.querySelector('#akCreate').insertAdjacentHTML('afterend',
      `<div class="card" style="margin-top:12px;border-color:var(--primary)">
         <b>Save this now — shown only once:</b>
         <div style="margin-top:8px"><code style="user-select:all;font-size:13px">${d.key}</code></div>
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

/* ---------- API DOCS ---------- */
async function renderApiDocs(el) {
  const origin = location.origin;
  el.innerHTML = `
    <h1>API Documentation</h1>
    <p class="muted" style="margin-bottom:20px">REST endpoints for external integrations</p>
    <div class="card">
      <h2>Authentication</h2>
      <p class="muted">All endpoints require <code>X-API-Key</code> header.</p>
      <p style="margin-top:10px">Base URL: <code>${origin}/api/external</code></p>
    </div>
    <div class="card">
      <h2>POST /verify</h2>
      <p class="muted">Validate a license key against a device.</p>
      <div class="table-wrap" style="margin-top:10px">
        <table>
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>key</code></td><td>string</td><td>License key</td></tr>
            <tr><td><code>device_id</code></td><td>string</td><td>Unique device fingerprint</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h2>Example (cURL)</h2>
      <pre style="background:rgba(0,0,0,0.3);padding:14px;border-radius:10px;overflow-x:auto;font-size:12px;color:#c4b5fd;margin-top:8px"><code style="background:none;padding:0">curl -X POST ${origin}/api/external/verify \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: api_xxxxxxxx" \\
  -d '{"key":"DEMO-XXXX-XXXX-XXXX","device_id":"dev-123"}'</code></pre>
    </div>
  `;
}

/* ---------- SETTINGS ---------- */
async function renderSettings(el) {
  const rank = ROLE_RANK[ME.role];
  const canEditBranding = rank >= ROLE_RANK.owner;
  let branding = { brand_name:'', brand_logo:'', brand_tagline:'', brand_footer:'', brand_color:'#7c3aed' };
  try { branding = await fetch('/api/branding').then(r => r.json()); } catch {}

  el.innerHTML = `
    <h1>Settings</h1>
    <p class="muted" style="margin-bottom:20px">Manage your account & site</p>
    <div class="card">
      <h2>Profile</h2>
      <div class="grid">
        <label>Username<input value="${ME.username}" disabled></label>
        <label>Role<input value="${ME.role.replace(/_/g,' ')}" disabled></label>
        <label>Balance<input value="${ME.balance}" disabled></label>
      </div>
    </div>
    ${canEditBranding ? `
    <div class="card">
      <h2>🎨 Branding</h2>
      <p class="muted" style="margin-bottom:14px">These fields appear on login page & dashboard.</p>
      <div class="grid">
        <label>Brand Name<input id="bName" maxlength="64" value="${branding.brand_name}"></label>
        <label>Logo (emoji)<input id="bLogo" maxlength="8" value="${branding.brand_logo}"></label>
        <label>Tagline<input id="bTagline" maxlength="96" value="${branding.brand_tagline}"></label>
        <label>Footer<input id="bFooter" maxlength="96" value="${branding.brand_footer}"></label>
        <label>Accent Color<input id="bColor" maxlength="7" value="${branding.brand_color}"></label>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="saveBranding">Save</button>
        <button class="ghost" id="resetBranding">Reset</button>
      </div>
    </div>` : ''}
  `;

  el.querySelector('#saveBranding')?.addEventListener('click', async () => {
    const payload = {
      brand_name: el.querySelector('#bName').value.trim(),
      brand_logo: el.querySelector('#bLogo').value.trim(),
      brand_tagline: el.querySelector('#bTagline').value.trim(),
      brand_footer: el.querySelector('#bFooter').value.trim(),
      brand_color: el.querySelector('#bColor').value.trim(),
    };
    const r = await fetch('/api/branding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Branding updated'); await loadBranding(); renderSettings(el);
  });
  el.querySelector('#resetBranding')?.addEventListener('click', async () => {
    if (!confirm('Reset branding to defaults?')) return;
    await fetch('/api/branding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_name:'YOUR BRAND NAME', brand_logo:'👑',
        brand_tagline:'License Management System',
        brand_footer:'SECURITY v2.0', brand_color:'#7c3aed',
      }),
    });
    toast('✓ Reset'); await loadBranding(); renderSettings(el);
  });
}

/* ---------- HELPERS ---------- */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

boot();
