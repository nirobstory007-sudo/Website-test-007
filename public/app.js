const ROLE_RANK = { super_hide_owner: 4, owner: 3, admin: 2, reseller: 1 };
let ME = null;

/* ============ FETCH HELPER WITH TIMEOUT ============ */
async function fetchT(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ============ BOOT ============ */
async function boot() {
  try { await loadBranding(); }
  catch (e) { console.error('branding:', e); }

  try {
    const r = await fetchT('/api/auth/me');
    if (!r.ok) { location.href = '/login.html'; return; }
    ME = (await r.json()).user;
  } catch (e) {
    console.error('Auth check failed:', e);
    document.getElementById('main').innerHTML = `
      <div class="card">
        <h2>⏳ Server waking up…</h2>
        <p class="muted">Render free tier sleeps after inactivity. First request can take 40-60 seconds.</p>
        <p class="muted" style="margin-top:8px">Wait a moment, then retry:</p>
        <button class="primary" style="margin-top:12px" onclick="location.reload()">🔄 Retry</button>
      </div>`;
    return;
  }

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
    const r = await fetchT('/api/branding', {}, 8000);
    if (!r.ok) return;
    const b = await r.json();
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('brandLogo', b.brand_logo);
    set('brandName', b.brand_name);
    document.title = b.brand_name + ' — Dashboard';
    if (b.brand_color) document.documentElement.style.setProperty('--primary', b.brand_color);
  } catch (e) { console.error('Branding error:', e); }
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
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/login.html';
  };
  document.getElementById('signOutBtn').onclick = signout;
  document.getElementById('logoutBtn').onclick = signout;
}

/* ============ VIEW ROUTER ============ */
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
  apitester: renderApiTester,
  settings: renderSettings,
  pricing: renderPricing,
};

async function showView(name) {
  const fn = views[name] || renderOverview;
  const main = document.getElementById('main');
  main.innerHTML = '<div class="card">Loading…</div>';
  try {
    await fn(main);
  } catch (e) {
    console.error('View error:', name, e);
    main.innerHTML = `<div class="card">
      <h2>⚠️ Error: ${name}</h2>
      <p class="muted">${e.message || 'Unknown error'}</p>
      <button class="primary" style="margin-top:12px" onclick="location.reload()">🔄 Retry</button>
    </div>`;
  }
}

/* ============ OVERVIEW ============ */
async function renderOverview(el) {
  let keys = [];
  let loadError = false;
  let errMsg = '';

  try {
    const res = await fetchT('/api/keys?per_page=200', {}, 25000);
    if (res.ok) {
      const data = await res.json();
      keys = data.keys || [];
    } else {
      loadError = true;
      errMsg = 'HTTP ' + res.status;
    }
  } catch (e) {
    loadError = true;
    errMsg = e.name === 'AbortError' ? 'Request timed out (25s)' : (e.message || 'Network error');
  }

  if (loadError) {
    el.innerHTML = `
      <div class="card">
        <h2>⚠️ Load failed</h2>
        <p class="muted" style="margin-top:8px;word-break:break-all"><b>Reason:</b> ${errMsg}</p>
        <button class="primary" style="margin-top:12px" onclick="location.reload()">🔄 Retry</button>
      </div>`;
    return;
  }

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

/* ============ GENERATE + LICENSE MANAGER ============ */
let LICENSES_STATE = { page: 1, q: '', status: 'all' };

async function renderKeys(el) {
  const rank = ROLE_RANK[ME.role];
  const canMaster = rank >= ROLE_RANK.owner;

  let pricingList = [];
  try {
    const pricingRes = await fetchT('/api/pricing', {}, 10000).then(r => r.json());
    pricingList = pricingRes.pricing || [];
  } catch (e) { console.error('pricing fetch error:', e); }

  const durations = [...new Set(pricingList.map(p => p.duration_days))].sort((a,b)=>a-b);
  const availableTiers = ['1','2','unlimited'].filter(t =>
    pricingList.some(p => p.device_tier === t)
  );
  const tierLabel = t => t === 'unlimited' ? 'Unlimited' : (t === '1' ? '1 device' : t + ' devices');

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
              ${availableTiers.map(t => `<option value="${t}">${tierLabel(t)}</option>`).join('')}
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
      const r = await fetchT('/api/keys/generate', {
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
    try {
      const res = await fetchT(`/api/keys?page=${LICENSES_STATE.page}&per_page=20&q=${encodeURIComponent(LICENSES_STATE.q)}&status=${LICENSES_STATE.status}`);
      const data = await res.json();
      renderLicTable(wrap, data, el);
    } catch (e) {
      wrap.innerHTML = '<div class="card">Failed to load keys.</div>';
    }
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
    const r = await fetchT('/api/keys/master/reset-all', { method: 'POST' });
    const d = await r.json();
    toast(`✓ Reset ${d.affected} keys`);
    renderKeys(el);
  });
  el.querySelector('#masterDelete')?.addEventListener('click', async () => {
    if (!confirm('DELETE every key?')) return;
    const r = await fetchT('/api/keys/master/delete-all', { method: 'POST' });
    const d = await r.json();
    toast(`✓ Deleted ${d.affected} keys`);
    renderKeys(el);
  });
}

function renderLicTable(wrap, data, rootEl) {
  const keys = data.keys || [];
  const pagination = data.pagination || { page: 1, per_page: 20, total: 0, total_pages: 1 };
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Key</th><th>Status</th><th>Devices</th><th>Duration</th>
              <th>Owner</th><th>Created</th><th style="text-align:right">Actions</th></tr>
        </thead>
        <tbody>
          ${keys.length === 0 ? `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No keys found</td></tr>` : ''}
          ${keys.map(k => {
            let pill;
            if (k.banned) pill = '<span class="badge danger">banned</span>';
            else if (k.status === 'used') pill = '<span class="badge warn">used</span>';
            else pill = '<span class="badge ok">active</span>';
            const tierLabel = k.device_tier === 'unlimited' ? 'unlimited' : (k.device_tier || '1') + ' device';
            return `
              <tr>
                <td><code>${k.key_value}</code></td>
                <td>${pill}</td>
                <td>${k.device_count || 0} / ${tierLabel}</td>
                <td>${k.duration_days}d</td>
                <td>${k.owner_name ?? '—'}</td>
                <td>${new Date(k.created_at*1000).toLocaleDateString()}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn-icon" data-details="${k.id}" title="View details">👁️</button>
                  <button class="btn-icon edit" data-reset="${k.id}" title="Reset HWID">🔄</button>
                  ${k.banned
                    ? `<button class="btn-icon" data-unban="${k.id}" title="Unban">↩️</button>`
                    : `<button class="btn-icon delete" data-ban="${k.id}" title="Ban">🚫</button>`}
                  <button class="btn-icon delete" data-del="${k.id}" title="Delete">🗑️</button>
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
    if (LICENSES_STATE.page > 1) { LICENSES_STATE.page--; refreshLic(rootEl); }
  });
  wrap.querySelector('#pgNext')?.addEventListener('click', () => {
    if (LICENSES_STATE.page < pagination.total_pages) { LICENSES_STATE.page++; refreshLic(rootEl); }
  });

  wrap.querySelectorAll('[data-details]').forEach(b => b.onclick = () => openDetailsModal(+b.dataset.details, rootEl));
  wrap.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    if (!confirm('Reset this license? The device binding will be cleared.')) return;
    const r = await fetchT(`/api/keys/${b.dataset.reset}/reset`, { method: 'POST' });
    if (!r.ok) return toast('✗ Reset failed');
    toast('✓ License reset'); refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-ban]').forEach(b => b.onclick = async () => {
    if (!confirm('Ban this license?')) return;
    const r = await fetchT(`/api/keys/${b.dataset.ban}/ban`, { method: 'POST' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ License banned'); refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-unban]').forEach(b => b.onclick = async () => {
    const r = await fetchT(`/api/keys/${b.dataset.unban}/unban`, { method: 'POST' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ License unbanned'); refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this license permanently?')) return;
    const r = await fetchT(`/api/keys/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); refreshLic(rootEl);
  });
}

function refreshLic(rootEl) {
  rootEl.querySelector('#licStatus').dispatchEvent(new Event('change'));
}

async function openDetailsModal(id, rootEl) {
  try {
    const r = await fetchT(`/api/keys/${id}/details`);
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
          <span class="badge role-admin">${k.device_tier === 'unlimited' ? 'unlimited' : (k.device_tier || '1') + ' device'}</span>
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
  } catch (e) {
    toast('✗ Failed to load details');
  }
}

/* ============ PRICING ============ */
async function renderPricing(el) {
  const { pricing = [] } = await fetchT('/api/pricing').then(r => r.json());
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
          <thead><tr><th>Duration</th><th>Devices</th><th>Cost</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${pricing.length === 0 ? '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No pricing rules yet</td></tr>' :
              pricing.map(p => `
                <tr>
                  <td><b>${p.duration_days}</b> day${p.duration_days>1?'s':''}</td>
                  <td>${p.device_tier === 'unlimited' ? 'Unlimited' : p.device_tier + ' device'}</td>
                  <td><b>${p.credit_cost}</b> cr</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn-icon edit" data-edit="${p.id}" data-cost="${p.credit_cost}" title="Edit">✏️</button>
                    <button class="btn-icon delete" data-del="${p.id}" title="Delete">🗑️</button>
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
    const r = await fetchT('/api/pricing', {
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
    const r = await fetchT(`/api/pricing/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); renderPricing(el);
  });

  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const cost = prompt('New credit cost:', b.dataset.cost);
    if (cost === null) return;
    const r = await fetchT(`/api/pricing/${b.dataset.edit}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credit_cost: +cost }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Updated'); renderPricing(el);
  });
}

/* ============ CREDITS ============ */
async function renderCredits(el) {
  const rank = ROLE_RANK[ME.role];
  const canTransfer = rank >= ROLE_RANK.admin;
  const me = await fetchT('/api/auth/me').then(r => r.json());
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
  const { users } = await fetchT('/api/users').then(r => r.json());
  const sel = el.querySelector('#txTo');
  users.filter(u => u.id !== ME.id).forEach(u => {
    const o = document.createElement('option');
    o.value = u.id; o.textContent = `${u.username} (${u.role})`;
    sel.appendChild(o);
  });
  el.querySelector('#txBtn').onclick = async () => {
    const to_user_id = +sel.value;
    const amount = +el.querySelector('#txAmt').value;
    const r = await fetchT('/api/credits/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_user_id, amount }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Transfer complete'); renderCredits(el);
  };
}

/* ============ USERS ============ */
async function renderUsers(el) {
  const { users } = await fetchT('/api/users').then(r => r.json());
  const myRank = ROLE_RANK[ME.role];
  const canCreate = myRank >= ROLE_RANK.admin;
  const canDelete = myRank >= ROLE_RANK.admin;

  const roleOptions = [];
  if (myRank > ROLE_RANK.owner)     roleOptions.push({ v: 'owner',    l: 'Owner' });
  if (myRank > ROLE_RANK.admin)     roleOptions.push({ v: 'admin',    l: 'Admin' });
  if (myRank > ROLE_RANK.reseller)  roleOptions.push({ v: 'reseller', l: 'Reseller' });

  el.innerHTML = `
    <h1>Users</h1>
    <p class="muted" style="margin-bottom:20px">Manage accounts below your role</p>
    ${canCreate ? `
      <div class="card">
        <h2>Create User</h2>
        <div class="grid">
          <label>Username<input id="uName"></label>
          <label>Password<input id="uPass" type="password"></label>
          <label>Role
            <select id="uRole">
              ${roleOptions.map(o => `<option value="${o.v}">${o.l}</option>`).join('')}
            </select>
          </label>
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
    const r = await fetchT('/api/users', {
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
    const r = await fetchT(`/api/users/${b.dataset.del}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); renderUsers(el);
  });
}

/* ============ AUDIT ============ */
async function renderAudit(el) {
  const { logs = [] } = await fetchT('/api/audit?limit=200').then(r => r.json());
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

/* ============ MASTER ============ */
async function renderMaster(el) {
  let prefix = 'DEMO';
  try {
    const r = await fetchT('/api/keys?per_page=1');
    const d = await r.json();
    if (d.prefix) prefix = d.prefix;
  } catch {}

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
    const r = await fetchT('/api/keys/prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Prefix updated'); renderMaster(el);
  };
}

/* ============ API KEYS ============ */
async function renderApiKeys(el) {
  const { apiKeys = [] } = await fetchT('/api/apikeys').then(r => r.json());
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
    const res = await fetchT('/api/apikeys', {
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
    await fetchT(`/api/apikeys/${b.dataset.revoke}/revoke`, { method: 'POST' });
    renderApiKeys(el);
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this API key?')) return;
    await fetchT(`/api/apikeys/${b.dataset.del}`, { method: 'DELETE' });
    renderApiKeys(el);
  });
}

/* ============ API TESTER (BUILT-IN) ============ */
async function renderApiTester(el) {
  let apiKey = null;
  try {
    const r = await fetchT('/api/apikeys/current');
    if (r.ok) {
      const d = await r.json();
      apiKey = d.apiKey;
    }
  } catch {}

  const keyFull = apiKey && apiKey.full ? apiKey.full : '';

  el.innerHTML = `
    <h1>🧪 API Tester</h1>
    <p class="muted" style="margin-bottom:20px">
      Test your external API endpoints directly from the dashboard. No ReqBin needed.
    </p>

    <div class="card">
      <h2>Endpoint</h2>
      <div class="grid">
        <label>Select Endpoint
          <select id="epSelect">
            <option value="check_balance">POST /check_balance</option>
            <option value="reset_hwid">POST /reset_hwid</option>
            <option value="generate_key">POST /generate_key</option>
            <option value="delete_key">POST /delete_key</option>
            <option value="register_device">POST /register_device</option>
          </select>
        </label>
      </div>

      <div id="epFields" style="margin-top:8px"></div>

      <div class="row" style="margin-top:12px">
        <button class="primary" id="testBtn">▶ Run Test</button>
        <button class="ghost" id="clearBtn">✕ Clear</button>
      </div>
    </div>

    <div class="card">
      <h2>Request Preview</h2>
      <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:6px">URL</div>
      <pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;color:#c4b5fd;margin-bottom:14px"><code style="background:none;padding:0" id="previewUrl"></code></pre>
      <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:6px">Body (JSON)</div>
      <pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;color:#86efac"><code style="background:none;padding:0" id="previewBody"></code></pre>
    </div>

    <div class="card">
      <h2>Response</h2>
      <div id="responseBlock" class="muted">No test run yet. Click "Run Test" above.</div>
    </div>
  `;

  const fieldsEl = el.querySelector('#epFields');
  const previewUrl = el.querySelector('#previewUrl');
  const previewBody = el.querySelector('#previewBody');
  const responseBlock = el.querySelector('#responseBlock');

  const field = (id, label, val = '', placeholder = '') => `
    <label>${label}
      <input id="${id}" value="${val}" placeholder="${placeholder}" autocomplete="off">
    </label>
  `;

  function renderFields() {
    const ep = el.querySelector('#epSelect').value;
    if (ep === 'check_balance') {
      fieldsEl.innerHTML = `<p class="muted">No extra fields needed — API key is added automatically.</p>`;
    } else if (ep === 'reset_hwid') {
      fieldsEl.innerHTML = field('f_key', 'License Key', '', 'ALIYA-XXXX-XXXX-XXXX');
    } else if (ep === 'generate_key') {
      fieldsEl.innerHTML = `
        <div class="grid">
          ${field('f_days', 'Days (must match pricing rule)', '30')}
          ${field('f_count', 'Count (max 10)', '1')}
          ${field('f_device', 'Device Tier (1/2/unlimited)', '1')}
        </div>`;
    } else if (ep === 'delete_key') {
      fieldsEl.innerHTML = field('f_key', 'License Key', '', 'ALIYA-XXXX-XXXX-XXXX');
    } else if (ep === 'register_device') {
      fieldsEl.innerHTML = `
        <div class="grid">
          ${field('f_key', 'License Key', '', 'ALIYA-XXXX-XXXX-XXXX')}
          ${field('f_hwid', 'Device HWID', '', 'device-fingerprint-123')}
        </div>`;
    }
    updatePreview();
  }

  function buildBody() {
    const ep = el.querySelector('#epSelect').value;
    const body = { api_key: keyFull };
    if (ep === 'reset_hwid' || ep === 'delete_key') {
      body.key = (el.querySelector('#f_key')?.value || '').trim();
    } else if (ep === 'generate_key') {
      body.days = +el.querySelector('#f_days').value || 30;
      body.count = +el.querySelector('#f_count').value || 1;
      body.device = (el.querySelector('#f_device').value || '1').trim();
    } else if (ep === 'register_device') {
      body.key = (el.querySelector('#f_key')?.value || '').trim();
      body.hwid = (el.querySelector('#f_hwid')?.value || '').trim();
    }
    return body;
  }

  function updatePreview() {
    const ep = el.querySelector('#epSelect').value;
    previewUrl.textContent = location.origin + '/api/external/' + ep;
    previewBody.textContent = JSON.stringify(buildBody(), null, 2);
  }

  el.querySelector('#epSelect').onchange = renderFields;
  renderFields();

  el.querySelector('#testBtn').onclick = async () => {
    const ep = el.querySelector('#epSelect').value;
    const body = buildBody();
    const url = '/api/external/' + ep;

    responseBlock.innerHTML = `<p class="muted">⏳ Sending…</p>`;

    try {
      const res = await fetchT(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 25000);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      const statusColor = res.ok ? 'var(--ok)' : 'var(--danger)';
      responseBlock.innerHTML = `
        <div class="row" style="margin-bottom:10px">
          <span class="badge" style="background:${statusColor};color:#fff;border:none">
            ${res.status} ${res.statusText || ''}
          </span>
          <span class="muted">${url}</span>
        </div>
        <pre style="background:rgba(0,0,0,0.4);padding:14px;border-radius:10px;overflow-x:auto;font-size:12.5px;color:#86efac;white-space:pre-wrap;word-break:break-all"><code style="background:none;padding:0">${pretty}</code></pre>
      `;
    } catch (e) {
      responseBlock.innerHTML = `
        <div class="card" style="border-color:var(--danger)">
          <h2 style="font-size:14px;color:#fca5a5">✗ Request failed</h2>
          <p class="muted" style="margin-top:6px;word-break:break-all">${e.message || e}</p>
        </div>`;
    }
  };

  el.querySelector('#clearBtn').onclick = () => {
    renderFields();
    responseBlock.innerHTML = '<p class="muted">No test run yet. Click "Run Test" above.</p>';
  };
}

/* ============ API DOCS ============ */
async function renderApiDocs(el) {
  const origin = location.origin;
  const baseUrl = `${origin}/api/external`;

  let apiKey = null;
  try {
    const r = await fetchT('/api/apikeys/current');
    if (r.ok) {
      const d = await r.json();
      apiKey = d.apiKey;
    }
  } catch {}

  const endpoint = (method, color, title, url, body, resp, curl) => `
    <div class="card" style="padding:0;overflow:hidden;margin-top:16px">
      <div style="background:${color};padding:14px 18px;display:flex;align-items:center;gap:12px">
        <span style="background:rgba(0,0,0,0.35);padding:4px 12px;border-radius:7px;font-size:11px;font-weight:900;letter-spacing:1.2px">${method}</span>
        <span style="font-weight:900;letter-spacing:0.5px;font-size:14px">${title}</span>
      </div>
      <div style="padding:18px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:8px">URL</div>
        <pre style="background:rgba(0,0,0,0.35);padding:14px;border-radius:10px;overflow-x:auto;font-size:12.5px;color:#c4b5fd;margin-bottom:18px"><code style="background:none;padding:0">${url}</code></pre>

        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:8px">Parameters (POST / JSON body)</div>
        <div class="table-wrap" style="margin-bottom:18px">
          <table>
            <thead><tr><th>Parameter</th><th>Type</th><th>Information</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>

        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:8px">Example Response</div>
        <pre style="background:rgba(0,0,0,0.35);padding:14px;border-radius:10px;overflow-x:auto;font-size:12px;color:#86efac;margin-bottom:18px"><code style="background:none;padding:0">${resp}</code></pre>

        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:8px">Example (cURL)</div>
        <pre style="background:rgba(0,0,0,0.35);padding:14px;border-radius:10px;overflow-x:auto;font-size:12px;color:#c4b5fd"><code style="background:none;padding:0">${curl}</code></pre>
      </div>
    </div>
  `;

  const keyDisplay = apiKey && apiKey.full
    ? apiKey.full
    : (apiKey ? `${apiKey.prefix}... (regenerate to reveal full key)` : 'Loading…');

  el.innerHTML = `
    <h1>API Documentation</h1>
    <p class="muted" style="margin-bottom:20px">REST endpoints for external integrations. Available for all roles.</p>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="background:linear-gradient(90deg,#3b82f6,#6366f1);padding:16px 20px;display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">🛡️</span>
        <span style="font-weight:900;letter-spacing:0.8px;font-size:14px">AUTHENTICATION</span>
      </div>
      <div style="padding:20px">
        <p style="line-height:1.7">All API requests must include <code>api_key</code> from your account — either in the request body OR as <code>X-API-Key</code> header.</p>
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin:18px 0 8px">Base URL</div>
        <pre style="background:rgba(0,0,0,0.35);padding:14px;border-radius:10px;overflow-x:auto;font-size:12.5px;color:#86efac"><code style="background:none;padding:0">${baseUrl}</code></pre>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div style="background:linear-gradient(90deg,#7c3aed,#a855f7);padding:16px 20px;display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">🔑</span>
        <span style="font-weight:900;letter-spacing:0.8px;font-size:14px">CONFIGURATION &amp; API KEY</span>
      </div>
      <div style="padding:20px">
        <div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:10px">Your API Key</div>

        <div style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap">
          <pre id="apiKeyBox" style="flex:1;min-width:240px;background:rgba(0,0,0,0.4);padding:16px;border-radius:12px;overflow-x:auto;font-size:13.5px;color:#86efac;margin:0;font-family:ui-monospace,monospace;font-weight:600;letter-spacing:0.5px"><code style="background:none;padding:0">${keyDisplay}</code></pre>
          <button class="primary" id="copyApiKey" style="align-self:stretch;min-width:100px">📋 Copy</button>
        </div>

        <div style="margin-top:18px">
          <button class="primary" id="regenApiKey">🔄 Generate New API Key</button>
        </div>

        <p class="muted" style="margin-top:16px;font-size:12.5px;line-height:1.7">
          ⚠️ Keep this key safe. Do not share it with anyone. Regenerating will invalidate the old key immediately.
        </p>
      </div>
    </div>

    ${endpoint('POST', 'linear-gradient(90deg,#f97316,#ea580c)', 'ENDPOINT: RESET KEY HWID', `${baseUrl}/reset_hwid`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>
       <tr><td><code>key</code></td><td>string</td><td>License key whose HWID to reset</td></tr>`,
      `{
  "status": "success",
  "message": "Hardware identifier has been reset successfully.",
  "key": "ALIYA-XXXX-XXXX-XXXX"
}`,
      `curl -X POST ${baseUrl}/reset_hwid \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"key":"ALIYA-XXXX-XXXX-XXXX"}'`
    )}

    ${endpoint('POST', 'linear-gradient(90deg,#10b981,#059669)', 'ENDPOINT: GENERATE KEY', `${baseUrl}/generate_key`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>
       <tr><td><code>days</code></td><td>int</td><td>License duration (must match a pricing rule)</td></tr>
       <tr><td><code>count</code></td><td>int</td><td>Number of keys to generate (max 10)</td></tr>
       <tr><td><code>device</code></td><td>string</td><td><code>1</code> · <code>2</code> · <code>unlimited</code> (optional, default 1)</td></tr>`,
      `{
  "status": "success",
  "keys": ["ALIYA-AB12-CD34-EF56"],
  "count": 1,
  "total_cost": 5,
  "new_balance": 95
}`,
      `curl -X POST ${baseUrl}/generate_key \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"days":30,"count":1,"device":"1"}'`
    )}

    ${endpoint('POST', 'linear-gradient(90deg,#f97316,#ea580c)', 'ENDPOINT: DELETE KEY', `${baseUrl}/delete_key`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>
       <tr><td><code>key</code></td><td>string</td><td>Single key to delete</td></tr>
       <tr><td><code>keys[]</code></td><td>array</td><td>Bulk delete (max 100)</td></tr>`,
      `{
  "status": "success",
  "message": "2 key(s) deleted successfully.",
  "deleted": 2,
  "deleted_keys": ["KEY001", "KEY002"]
}`,
      `curl -X POST ${baseUrl}/delete_key \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"keys":["KEY001","KEY002"]}'`
    )}

    ${endpoint('POST', 'linear-gradient(90deg,#f97316,#ea580c)', 'ENDPOINT: REGISTER DEVICE (Unlimited Tracking)', `${baseUrl}/register_device`,
      `<tr><td><code>key</code></td><td>string</td><td>License key</td></tr>
       <tr><td><code>hwid</code></td><td>string</td><td>Hardware ID / device fingerprint</td></tr>`,
      `{
  "status": "ok",
  "message": "device registered",
  "total_devices": 3
}`,
      `curl -X POST ${baseUrl}/register_device \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"key":"ALIYA-XXXX-XXXX-XXXX","hwid":"dev-abc-123"}'`
    )}

    ${endpoint('POST', 'linear-gradient(90deg,#ef4444,#dc2626)', 'ENDPOINT: CHECK BALANCE', `${baseUrl}/check_balance`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>`,
      `{
  "status": "success",
  "username": "root",
  "credits": 999999,
  "role": "super_hide_owner"
}`,
      `curl -X POST ${baseUrl}/check_balance \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY"`
    )}

    <div class="card" style="margin-top:20px;border-color:rgba(124,58,237,0.4);background:rgba(124,58,237,0.06)">
      <h2 style="font-size:14px">ℹ️ Notes</h2>
      <ul style="margin:8px 0 0 20px;padding:0;line-height:1.8;color:var(--text-2);font-size:13px">
        <li>All endpoints require <code>api_key</code> — either as body field OR <code>X-API-Key</code> header.</li>
        <li>Credits are deducted automatically when generating keys according to the pricing set in the panel.</li>
        <li>Resellers can only delete or reset their own keys. Owners and Super Owners can act on any key.</li>
        <li>Banned keys return <code>valid: false, reason: "banned"</code> on verification.</li>
      </ul>
    </div>
  `;

  el.querySelector('#copyApiKey')?.addEventListener('click', async () => {
    if (!apiKey || !apiKey.full) return toast('✗ No key to copy');
    try {
      await navigator.clipboard.writeText(apiKey.full);
      toast('✓ API key copied');
    } catch {
      toast('✗ Copy failed — long press to select');
    }
  });

  el.querySelector('#regenApiKey')?.addEventListener('click', async () => {
    if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
    const r = await fetchT('/api/apikeys/regenerate', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ New API key generated');
    renderApiDocs(el);
  });
}

/* ============ SETTINGS ============ */
async function renderSettings(el) {
  const rank = ROLE_RANK[ME.role];
  const canEditBranding = rank >= ROLE_RANK.owner;
  const canManageLinks = rank >= ROLE_RANK.admin;
  const canManageMaster = rank >= ROLE_RANK.owner;

  let branding = { brand_name:'', brand_logo:'', brand_tagline:'', brand_footer:'', brand_color:'#7c3aed' };
  try { branding = await fetchT('/api/branding').then(r => r.json()); } catch {}

  let links = [];
  if (canManageLinks) {
    try {
      const d = await fetchT('/api/reset-links').then(r => r.json());
      links = d.links || [];
    } catch {}
  }
  const myLinks = links.filter(l => !l.is_master);
  const masterLinks = links.filter(l => l.is_master);

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

    ${canManageLinks ? `
    <div class="card">
      <h2>🔗 My Reset Links</h2>
      <p class="muted" style="margin-bottom:14px">
        Share these links with your customers. Each link can ONLY reset keys that belong to you.
      </p>

      <div class="grid">
        <label>Note (optional)
          <input id="rlNote" placeholder="e.g. For customer Ahmed" maxlength="80">
        </label>
        <label>Max uses (optional, empty = unlimited)
          <input id="rlMaxUses" type="number" min="1" placeholder="unlimited">
        </label>
      </div>
      <button class="primary" id="rlCreate" style="margin-top:8px">🔗 Create My Reset Link</button>

      <div class="table-wrap" style="margin-top:18px">
        <table>
          <thead><tr><th>Link</th><th>Note</th><th>Uses</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${myLinks.length === 0 ? '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No reset links yet</td></tr>' :
              myLinks.map(l => `
                <tr>
                  <td><code>${l.token.slice(0, 16)}…</code></td>
                  <td>${l.note || '—'}</td>
                  <td>${l.uses}${l.max_uses ? ' / ' + l.max_uses : ''}</td>
                  <td>${new Date(l.created_at*1000).toLocaleDateString()}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn-icon edit" data-copy="${l.token}" title="Copy URL">📋</button>
                    <button class="btn-icon delete" data-rm="${l.id}" title="Delete">🗑️</button>
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    ${canManageMaster ? `
    <div class="card" style="border-color:rgba(239,68,68,0.5);background:rgba(239,68,68,0.04)">
      <h2>🌐 Master Reset Link (Owner Only)</h2>
      <p class="muted" style="margin-bottom:14px;color:#fca5a5">
        ⚠️ This link can reset ANY key on the entire site, regardless of owner.
      </p>

      <button class="danger" id="rlMasterCreate">🌐 Generate Master Reset Link</button>

      <div class="table-wrap" style="margin-top:18px">
        <table>
          <thead><tr><th>Master Link</th><th>Note</th><th>Uses</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${masterLinks.length === 0 ? '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No master link created yet</td></tr>' :
              masterLinks.map(l => `
                <tr>
                  <td><code>${l.token.slice(0, 16)}…</code></td>
                  <td>${l.note || '—'}</td>
                  <td>${l.uses}${l.max_uses ? ' / ' + l.max_uses : ''}</td>
                  <td>${new Date(l.created_at*1000).toLocaleDateString()}</td>
                  <td style="text-align:right;white-space:nowrap">
                    <button class="btn-icon edit" data-copy="${l.token}" title="Copy URL">📋</button>
                    <button class="btn-icon delete" data-rm="${l.id}" title="Delete">🗑️</button>
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    ${canEditBranding ? `
    <div class="card">
      <h2>🎨 Branding</h2>
      <p class="muted" style="margin-bottom:14px">These fields appear on login page, reset page & dashboard.</p>
      <div class="grid">
        <label>Brand Name<input id="bName" maxlength="64" value="${branding.brand_name}"></label>
        <label>Logo (emoji)<input id="bLogo" maxlength="8" value="${branding.brand_logo}"></label>
        <label>Tagline<input id="bTagline" maxlength="96" value="${branding.brand_tagline}"></label>
        <label>Footer<input id="bFooter" maxlength="96" value="${branding.brand_footer}"></label>
        <label>Accent Color<input id="bColor" maxlength="7" value="${branding.brand_color}"></label>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="saveBranding">Save Branding</button>
        <button class="ghost" id="resetBranding">Reset to Default</button>
      </div>
    </div>` : ''}
  `;

  el.querySelector('#rlCreate')?.addEventListener('click', async () => {
    const note = el.querySelector('#rlNote').value.trim();
    const maxUsesRaw = el.querySelector('#rlMaxUses').value.trim();
    const max_uses = maxUsesRaw ? parseInt(maxUsesRaw, 10) : '';
    const r = await fetchT('/api/reset-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, max_uses }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    const url = location.origin + d.url;
    try {
      await navigator.clipboard.writeText(url);
      toast('✓ Link created & copied!');
    } catch {
      prompt('Copy this URL:', url);
    }
    renderSettings(el);
  });

  el.querySelector('#rlMasterCreate')?.addEventListener('click', async () => {
    if (!confirm('Create a MASTER reset link? This can reset ANY key on the site.')) return;
    const note = prompt('Note (optional):', 'Master Reset Link') || '';
    const r = await fetchT('/api/reset-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, is_master: true }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    const url = location.origin + d.url;
    try {
      await navigator.clipboard.writeText(url);
      toast('✓ Master link created & copied!');
    } catch {
      prompt('Copy this URL:', url);
    }
    renderSettings(el);
  });

  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    const url = location.origin + '/reset.html?token=' + b.dataset.copy;
    try {
      await navigator.clipboard.writeText(url);
      toast('✓ Copied to clipboard');
    } catch {
      prompt('Copy this URL:', url);
    }
  });

  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this reset link?')) return;
    const r = await fetchT(`/api/reset-links/${b.dataset.rm}`, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted'); renderSettings(el);
  });

  el.querySelector('#saveBranding')?.addEventListener('click', async () => {
    const payload = {
      brand_name: el.querySelector('#bName').value.trim(),
      brand_logo: el.querySelector('#bLogo').value.trim(),
      brand_tagline: el.querySelector('#bTagline').value.trim(),
      brand_footer: el.querySelector('#bFooter').value.trim(),
      brand_color: el.querySelector('#bColor').value.trim(),
    };
    const r = await fetchT('/api/branding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Branding updated'); await loadBranding(); renderSettings(el);
  });

  el.querySelector('#resetBranding')?.addEventListener('click', async () => {
    if (!confirm('Reset branding to defaults?')) return;
    await fetchT('/api/branding', {
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

/* ============ HELPERS ============ */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

boot();
