const ROLE_RANK = { super_hide_owner: 4, owner: 3, admin: 2, reseller: 1 };
let ME = null;

/* ============ FETCH WITH TIMEOUT ============ */
async function fetchT(url, opts = {}, ms = 20000) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/* ============ BOOT ============ */
async function boot() {
  try { await loadBranding(); } catch (e) { console.error(e); }

  let meResp;
  try {
    meResp = await fetchT('/api/auth/me');
  } catch (e) {
    document.getElementById('main').innerHTML =
      '<div class="card"><h2>⏳ Server waking up…</h2><p class="muted">Wait 60 seconds, then reload.</p><button class="primary" style="margin-top:12px" onclick="location.reload()">🔄 Retry</button></div>';
    return;
  }
  if (!meResp.ok) { location.href = '/login.html'; return; }

  try {
    const j = await meResp.json();
    ME = j.user;
  } catch (e) {
    location.href = '/login.html';
    return;
  }
  if (!ME) { location.href = '/login.html'; return; }

  document.getElementById('balanceVal').textContent = ME.balance;
  document.getElementById('userName').textContent = ME.username;
  document.getElementById('userRole').textContent = ME.role.replace(/_/g, ' ');
  document.getElementById('userAvatar').textContent = ME.username.charAt(0).toUpperCase();

  applyRoleVisibility();
  bindNav();
  showView('overview');
}

async function loadBranding() {
  const r = await fetchT('/api/branding', {}, 8000);
  if (!r.ok) return;
  const b = await r.json();
  applyLogoTo('brandLogo', b.brand_logo);
  const nm = document.getElementById('brandName');
  if (nm) nm.textContent = b.brand_name;
  document.title = b.brand_name + ' — Dashboard';
  if (b.brand_color) document.documentElement.style.setProperty('--primary', b.brand_color);
}

function applyLogoTo(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val && typeof val === 'string' && val.startsWith('data:image/')) {
    el.innerHTML = '<img src="' + val + '" alt="logo" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:inherit">';
  } else {
    el.textContent = val || '👑';
  }
}

function applyRoleVisibility() {
  const rank = ROLE_RANK[ME.role] || 0;
  document.querySelectorAll('.nav-item').forEach(el => {
    const min = el.dataset.minRole || 'reseller';
    if (rank < (ROLE_RANK[min] || 0)) el.hidden = true;
  });
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sb = document.getElementById('sidebar');
      if (sb && window.innerWidth <= 720) sb.classList.remove('open');
      showView(btn.dataset.view);
    };
  });
  const burger = document.getElementById('burger');
  if (burger) burger.onclick = () => {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.toggle('open');
  };
  const logout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    location.href = '/login.html';
  };
  const so = document.getElementById('signOutBtn');
  const lo = document.getElementById('logoutBtn');
  if (so) so.onclick = logout;
  if (lo) lo.onclick = logout;
}

/* ============ VIEW ROUTER ============ */
const views = {};
let LICENSES_STATE = { page: 1, q: '', status: 'all' };

async function showView(name) {
  const fn = views[name] || renderOverview;
  const main = document.getElementById('main');
  main.innerHTML = '<div class="card">Loading…</div>';
  try {
    await fn(main);
  } catch (e) {
    console.error('View error:', name, e);
    main.innerHTML =
      '<div class="card"><h2>⚠️ Error: ' + name + '</h2><p class="muted">' + (e.message || 'Unknown') + '</p><button class="primary" style="margin-top:12px" onclick="location.reload()">🔄 Retry</button></div>';
  }
}

/* ============ OVERVIEW ============ */
async function renderOverview(el) {
  let keys = [];
  let error = null;
  try {
    const res = await fetchT('/api/keys?per_page=500', {}, 25000);
    if (res.ok) {
      const data = await res.json();
      keys = data.keys || [];
    } else {
      error = 'HTTP ' + res.status;
    }
  } catch (e) {
    error = e.message || 'Network error';
  }

  if (error) {
    el.innerHTML =
      '<div class="card"><h2>⚠️ Load failed</h2><p class="muted">' + error + '</p><button class="primary" style="margin-top:12px" onclick="location.reload()">🔄 Retry</button></div>';
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const total = keys.length;

  const active = keys.filter(k =>
    !k.banned && (k.status === 'active' || k.status === 'used') &&
    !(k.used_at && (k.used_at + k.duration_days * 86400) < now)
  ).length;

  const unused = keys.filter(k =>
    !k.banned && k.status === 'active' && !k.device_id
  ).length;

  const paused = keys.filter(k => k.banned).length;

  const expired = keys.filter(k =>
    k.used_at && (k.used_at + k.duration_days * 86400) < now
  ).length;

  const pieActive = active;
  const pieUnused = unused;
  const piePaused = paused;
  const pieTotal = pieActive + pieUnused + piePaused || 1;
  const activePct = Math.round((pieActive / pieTotal) * 100);
  const unusedPct = Math.round((pieUnused / pieTotal) * 100);
  const pausedPct = 100 - activePct - unusedPct;

  const R = 55;
  const C = 2 * Math.PI * R;

  const seg1 = (pieActive / pieTotal) * C;
  const seg2 = (pieUnused / pieTotal) * C;
  const seg3 = (piePaused / pieTotal) * C;

  el.innerHTML =
    '<div class="dash-header">' +
      '<span class="dash-burger">☰</span>' +
      '<h1>Dashboard</h1>' +
    '</div>' +

    '<div class="stack-grid">' +
      '<div class="stack-card">' +
        '<div class="s-icon">🔑</div>' +
        '<div class="s-lbl">Total Licenses</div>' +
        '<div class="s-num">' + total + '</div>' +
        '<div class="s-desc"><span style="color:#f59e0b">●</span> All time generated</div>' +
      '</div>' +
      '<div class="stack-card">' +
        '<div class="s-icon">⚡</div>' +
        '<div class="s-lbl">Active Keys</div>' +
        '<div class="s-num">' + active + '</div>' +
        '<div class="s-desc"><span class="status-dot"></span> Currently running</div>' +
      '</div>' +
      '<div class="stack-card">' +
        '<div class="s-icon">📦</div>' +
        '<div class="s-lbl">Unused Stock</div>' +
        '<div class="s-num">' + unused + '</div>' +
        '<div class="s-desc">🧺 Keys ready to sell</div>' +
      '</div>' +
    '</div>' +

    '<div class="analytics-title">🚀 Quick Access</div>' +
    '<div class="qa-grid">' +
      '<button class="qa-btn" data-jump="keys"><span class="qa-icon">➕</span>Generate</button>' +
      '<button class="qa-btn" data-jump="licenses"><span class="qa-icon">🔑</span>Licenses</button>' +
      '<button class="qa-btn qa-full" data-jump="settings"><span class="qa-icon">⚙️</span>Settings</button>' +
    '</div>' +

    '<div class="user-card-dash">' +
      '<div>' +
        '<div class="uc-label">Username</div>' +
        '<div class="uc-name">' + ME.username.toUpperCase() + '</div>' +
      '</div>' +
      '<span class="badge role-' + ME.role + ' uc-badge">' + ME.role.replace(/_/g, ' ') + '</span>' +
    '</div>' +

    '<div class="analytics-title">📊 Detailed Analytics</div>' +

    '<div class="an-grid">' +
      '<div class="an-card">' +
        '<div class="an-icon green">🔑</div>' +
        '<div class="an-num">' + total + '</div>' +
        '<div class="an-lbl">Total Keys</div>' +
        '<div class="an-sub">// ' + expired + ' expired</div>' +
      '</div>' +
      '<div class="an-card">' +
        '<div class="an-icon blue">👥</div>' +
        '<div class="an-num">' + active + '</div>' +
        '<div class="an-lbl">Active Keys</div>' +
        '<div class="an-sub">// running now</div>' +
      '</div>' +
      '<div class="an-card">' +
        '<div class="an-icon red">🚫</div>' +
        '<div class="an-num">' + unused + '</div>' +
        '<div class="an-lbl">Unused Keys</div>' +
        '<div class="an-sub">// never activated</div>' +
      '</div>' +
      '<div class="an-card">' +
        '<div class="an-icon orange">⏸️</div>' +
        '<div class="an-num">' + paused + '</div>' +
        '<div class="an-lbl">Paused Keys</div>' +
        '<div class="an-sub">// suspended</div>' +
      '</div>' +
    '</div>' +

    '<div class="pie-card">' +
      '<div class="pie-head">' +
        '<h2>Pie Chart</h2>' +
        '<span class="live-pill"><span class="pulse"></span>Live</span>' +
      '</div>' +

      '<div class="pie-wrap">' +
        '<svg width="180" height="180" viewBox="0 0 140 140">' +
          '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="16"/>' +
          '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#10b981" stroke-width="16"' +
            ' stroke-dasharray="' + seg1 + ' ' + C + '"' +
            ' stroke-dashoffset="0"' +
            ' transform="rotate(-90 70 70)" stroke-linecap="butt"/>' +
          '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#ef4444" stroke-width="16"' +
            ' stroke-dasharray="' + seg2 + ' ' + C + '"' +
            ' stroke-dashoffset="-' + seg1 + '"' +
            ' transform="rotate(-90 70 70)" stroke-linecap="butt"/>' +
          '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#f59e0b" stroke-width="16"' +
            ' stroke-dasharray="' + seg3 + ' ' + C + '"' +
            ' stroke-dashoffset="-' + (seg1 + seg2) + '"' +
            ' transform="rotate(-90 70 70)" stroke-linecap="butt"/>' +
          '<text x="70" y="68" text-anchor="middle" fill="#ffffff" font-size="20" font-weight="900">' + total + '</text>' +
          '<text x="70" y="86" text-anchor="middle" fill="#7a7a9a" font-size="9" font-weight="800" letter-spacing="1">TOTAL</text>' +
        '</svg>' +
      '</div>' +

      '<div class="pie-legend">' +
        '<div>' +
          '<div class="leg-row">' +
            '<span class="leg-dot" style="background:#10b981"></span>' +
            '<span class="leg-name">Active</span>' +
            '<span class="leg-val">' + pieActive + '</span>' +
          '</div>' +
          '<div class="leg-bar" style="background:#10b981;width:' + activePct + '%"></div>' +
        '</div>' +
        '<div>' +
          '<div class="leg-row">' +
            '<span class="leg-dot" style="background:#ef4444"></span>' +
            '<span class="leg-name">Unused</span>' +
            '<span class="leg-val">' + pieUnused + '</span>' +
          '</div>' +
          '<div class="leg-bar" style="background:#ef4444;width:' + unusedPct + '%"></div>' +
        '</div>' +
        '<div>' +
          '<div class="leg-row">' +
            '<span class="leg-dot" style="background:#f59e0b"></span>' +
            '<span class="leg-name">Paused</span>' +
            '<span class="leg-val">' + piePaused + '</span>' +
          '</div>' +
          '<div class="leg-bar" style="background:#f59e0b;width:' + pausedPct + '%"></div>' +
        '</div>' +
        '<div>' +
          '<div class="leg-row">' +
            '<span class="leg-dot" style="background:#8b5cf6"></span>' +
            '<span class="leg-name">Total</span>' +
            '<span class="leg-val">' + total + '</span>' +
          '</div>' +
          '<div class="leg-bar" style="background:#8b5cf6;width:100%"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  el.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => {
    const target = b.dataset.jump;
    document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
    const navBtn = document.querySelector('.nav-item[data-view="' + target + '"]');
    if (navBtn) { navBtn.classList.add('active'); showView(target); }
  });
}
views.overview = renderOverview;

/* ============ GENERATE KEYS (SEPARATE PAGE) ============ */
async function renderGenerateKeys(el) {
  const rank = ROLE_RANK[ME.role] || 0;

  let pricingList = [];
  try {
    const pr = await fetchT('/api/pricing', {}, 10000);
    const pj = await pr.json();
    pricingList = pj.pricing || [];
  } catch (e) {}

  const durations = [...new Set(pricingList.map(p => p.duration_days))].sort((a, b) => a - b);
  const tiers = ['1', '2', 'unlimited'].filter(t => pricingList.some(p => p.device_tier === t));
  const tLabel = t => t === 'unlimited' ? 'Unlimited' : (t === '1' ? '1 device' : t + ' devices');

  let genHTML;
  if (pricingList.length === 0) {
    genHTML = '<p class="muted">No pricing rules configured yet. Ask an Owner to set prices in <b>Pricing</b>.</p>';
  } else {
    genHTML =
      '<div class="grid">' +
      '<label>Duration<select id="genDuration">' + durations.map(d => '<option value="' + d + '">' + d + ' day' + (d > 1 ? 's' : '') + '</option>').join('') + '</select></label>' +
      '<label>Devices<select id="genTier">' + tiers.map(t => '<option value="' + t + '">' + tLabel(t) + '</option>').join('') + '</select></label>' +
      '<label>Quantity<input id="genCount" type="number" min="1" max="' + (rank >= ROLE_RANK.admin ? 200 : 50) + '" value="1"></label>' +
      '</div>' +
      '<div class="stat" style="margin-top:12px"><div class="lbl">Cost per key</div><div class="num" id="costPerKey">—</div><div class="desc">Total: <b id="costTotal">—</b> · Balance: <b>' + ME.balance + '</b></div></div>' +
      '<button class="primary" id="genBtn" style="margin-top:12px">Generate Batch</button>';
  }

  el.innerHTML =
    '<h1>Generate Keys</h1>' +
    '<p class="muted" style="margin-bottom:20px">Pick duration & device count — cost is calculated automatically</p>' +
    '<div class="card">' + genHTML + '</div>';

  if (pricingList.length) {
    const upd = () => {
      const d = +el.querySelector('#genDuration').value;
      const t = el.querySelector('#genTier').value;
      const q = +el.querySelector('#genCount').value || 1;
      const r = pricingList.find(p => p.duration_days === d && p.device_tier === t);
      const u = r ? r.credit_cost : '—';
      el.querySelector('#costPerKey').textContent = u === '—' ? '—' : u + ' credits';
      el.querySelector('#costTotal').textContent = u === '—' ? '—' : (u * q) + ' credits';
    };
    el.querySelector('#genDuration').onchange = upd;
    el.querySelector('#genTier').onchange = upd;
    el.querySelector('#genCount').oninput = upd;
    upd();

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
      toast('✓ Generated ' + data.keys.length + ' key(s) — ' + data.total_cost + ' credits');
      renderGenerateKeys(el);
    };
  }
}
views.keys = renderGenerateKeys;

/* ============ LICENSE MANAGER (SEPARATE PAGE) ============ */
async function renderLicenseManager(el) {
  const rank = ROLE_RANK[ME.role] || 0;
  const canMaster = rank >= ROLE_RANK.owner;

  el.innerHTML =
    '<h1>License Manager</h1>' +
    '<p class="muted" style="margin-bottom:20px">View, search, and manage all your license keys</p>' +
    '<div class="card">' +
    '<div class="grid" style="margin-bottom:12px">' +
    '<label>Search<input id="licSearch" placeholder="Key / Username / Device ID" value="' + LICENSES_STATE.q + '"></label>' +
    '<label>Status<select id="licStatus">' +
    '<option value="all"' + (LICENSES_STATE.status === 'all' ? ' selected' : '') + '>All</option>' +
    '<option value="active"' + (LICENSES_STATE.status === 'active' ? ' selected' : '') + '>Active</option>' +
    '<option value="used"' + (LICENSES_STATE.status === 'used' ? ' selected' : '') + '>Used</option>' +
    '<option value="banned"' + (LICENSES_STATE.status === 'banned' ? ' selected' : '') + '>Banned</option>' +
    '<option value="expired"' + (LICENSES_STATE.status === 'expired' ? ' selected' : '') + '>Expired</option>' +
    '</select></label></div>' +
    (canMaster ? '<div class="row" style="margin-bottom:12px"><button class="ghost small" id="masterReset">Reset ALL</button><button class="danger small" id="masterDelete">Delete ALL</button></div>' : '') +
    '<div id="licTable"><div class="card">Loading…</div></div>' +
    '</div>';

  const reload = async () => {
    const w = el.querySelector('#licTable');
    w.innerHTML = '<div class="card">Loading…</div>';
    try {
      const res = await fetchT('/api/keys?page=' + LICENSES_STATE.page + '&per_page=20&q=' + encodeURIComponent(LICENSES_STATE.q) + '&status=' + LICENSES_STATE.status);
      const data = await res.json();
      renderLicTable(w, data, el);
    } catch (e) {
      w.innerHTML = '<div class="card">Failed to load keys. <button class="ghost small" onclick="location.reload()">Retry</button></div>';
    }
  };

  el.querySelector('#licSearch').oninput = (e) => {
    LICENSES_STATE.q = e.target.value;
    LICENSES_STATE.page = 1;
    clearTimeout(el._t);
    el._t = setTimeout(reload, 350);
  };
  el.querySelector('#licStatus').onchange = (e) => {
    LICENSES_STATE.status = e.target.value;
    LICENSES_STATE.page = 1;
    reload();
  };

  await reload();

  const mr = el.querySelector('#masterReset');
  if (mr) mr.onclick = async () => {
    if (!confirm('Reset EVERY key?')) return;
    const r = await fetchT('/api/keys/master/reset-all', { method: 'POST' });
    const d = await r.json();
    toast('✓ Reset ' + d.affected + ' keys');
    reload();
  };
  const md = el.querySelector('#masterDelete');
  if (md) md.onclick = async () => {
    if (!confirm('DELETE every key?')) return;
    const r = await fetchT('/api/keys/master/delete-all', { method: 'POST' });
    const d = await r.json();
    toast('✓ Deleted ' + d.affected + ' keys');
    reload();
  };
}
views.licenses = renderLicenseManager;

/* ============ SHARED LICENSE TABLE ============ */
function renderLicTable(wrap, data, rootEl) {
  const keys = data.keys || [];
  const pg = data.pagination || { page: 1, per_page: 20, total: 0, total_pages: 1 };
  let rows = '';
  for (const k of keys) {
    let pill;
    if (k.banned) pill = '<span class="badge danger">banned</span>';
    else if (k.status === 'used') pill = '<span class="badge warn">used</span>';
    else pill = '<span class="badge ok">active</span>';
    const tl = k.device_tier === 'unlimited' ? 'unlimited' : (k.device_tier || '1') + ' device';
    rows +=
      '<tr>' +
      '<td><code>' + k.key_value + '</code></td>' +
      '<td>' + pill + '</td>' +
      '<td>' + (k.device_count || 0) + ' / ' + tl + '</td>' +
      '<td>' + k.duration_days + 'd</td>' +
      '<td>' + (k.owner_name || '—') + '</td>' +
      '<td>' + new Date(k.created_at * 1000).toLocaleDateString() + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button class="btn-icon" data-details="' + k.id + '" title="Details">👁️</button>' +
      '<button class="btn-icon edit" data-reset="' + k.id + '" title="Reset">🔄</button>' +
      (k.banned
        ? '<button class="btn-icon" data-unban="' + k.id + '" title="Unban">↩️</button>'
        : '<button class="btn-icon delete" data-ban="' + k.id + '" title="Ban">🚫</button>') +
      '<button class="btn-icon delete" data-del="' + k.id + '" title="Delete">🗑️</button>' +
      '</td>' +
      '</tr>';
  }
  if (!rows) rows = '<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No keys found</td></tr>';

  wrap.innerHTML =
    '<div class="table-wrap"><table><thead><tr><th>Key</th><th>Status</th><th>Devices</th><th>Duration</th><th>Owner</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    '<div class="row" style="margin-top:12px;justify-content:space-between">' +
    '<span class="muted">Page ' + pg.page + ' of ' + pg.total_pages + ' · ' + pg.total + ' total</span>' +
    '<div class="row">' +
    '<button class="ghost small" id="pgPrev"' + (pg.page <= 1 ? ' disabled' : '') + '>← Previous</button>' +
    '<button class="ghost small" id="pgNext"' + (pg.page >= pg.total_pages ? ' disabled' : '') + '>Next →</button>' +
    '</div></div>';

  const pv = wrap.querySelector('#pgPrev');
  const nx = wrap.querySelector('#pgNext');
  if (pv) pv.onclick = () => { if (LICENSES_STATE.page > 1) { LICENSES_STATE.page--; refreshLic(rootEl); } };
  if (nx) nx.onclick = () => { if (LICENSES_STATE.page < pg.total_pages) { LICENSES_STATE.page++; refreshLic(rootEl); } };

  wrap.querySelectorAll('[data-details]').forEach(b => b.onclick = () => openDetailsModal(+b.dataset.details, rootEl));
  wrap.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    if (!confirm('Reset this license? The device binding will be cleared.')) return;
    const r = await fetchT('/api/keys/' + b.dataset.reset + '/reset', { method: 'POST' });
    if (!r.ok) return toast('✗ Reset failed');
    toast('✓ License reset');
    refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-ban]').forEach(b => b.onclick = async () => {
    if (!confirm('Ban this license? User will not be able to log in.')) return;
    const r = await fetchT('/api/keys/' + b.dataset.ban + '/ban', { method: 'POST' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ License banned');
    refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-unban]').forEach(b => b.onclick = async () => {
    const r = await fetchT('/api/keys/' + b.dataset.unban + '/unban', { method: 'POST' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ License unbanned');
    refreshLic(rootEl);
  });
  wrap.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this license permanently?')) return;
    const r = await fetchT('/api/keys/' + b.dataset.del, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted');
    refreshLic(rootEl);
  });
}

function refreshLic(rootEl) {
  const s = rootEl.querySelector('#licStatus');
  if (s) s.dispatchEvent(new Event('change'));
}

async function openDetailsModal(id, rootEl) {
  try {
    const r = await fetchT('/api/keys/' + id + '/details');
    const data = await r.json();
    if (!r.ok) return toast('✗ ' + data.error);
    const k = data.key;
    const ds = data.devices || [];

    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:grid;place-items:center;z-index:200;padding:20px';

    let dRows = '';
    for (const d of ds) {
      dRows += '<tr><td><code>' + d.device_id + '</code></td><td>' + new Date(d.first_seen * 1000).toLocaleString() + '</td><td>' + new Date(d.last_seen * 1000).toLocaleString() + '</td></tr>';
    }
    const dTable = ds.length === 0 ? '<p class="muted">No devices bound yet.</p>' :
      '<div class="table-wrap"><table><thead><tr><th>Device ID</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>' + dRows + '</tbody></table></div>';

    ov.innerHTML =
      '<div class="card" style="max-width:520px;width:100%;max-height:85vh;overflow-y:auto">' +
      '<div class="row" style="justify-content:space-between;margin-bottom:14px"><h2 style="margin:0">License Details</h2><button class="icon-btn" id="closeModal">✕</button></div>' +
      '<div class="row" style="gap:8px;margin-bottom:14px;flex-wrap:wrap">' +
      (k.banned ? '<span class="badge danger">banned</span>' : '<span class="badge ' + (k.status === 'used' ? 'warn' : 'ok') + '">' + k.status + '</span>') +
      '<span class="badge role-admin">' + (k.device_tier === 'unlimited' ? 'unlimited' : (k.device_tier || '1') + ' device') + '</span>' +
      '<span class="badge">' + k.duration_days + ' days</span></div>' +
      '<label>Key<input value="' + k.key_value + '" readonly style="font-family:monospace"></label>' +
      '<div class="grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="stat"><div class="lbl">Owner</div><div class="desc" style="color:var(--text);font-size:14px">' + (k.owner_name || '—') + '</div></div>' +
      '<div class="stat"><div class="lbl">Created by</div><div class="desc" style="color:var(--text);font-size:14px">' + (k.creator_name || '—') + '</div></div>' +
      '<div class="stat"><div class="lbl">Created</div><div class="desc" style="color:var(--text);font-size:14px">' + new Date(k.created_at * 1000).toLocaleString() + '</div></div>' +
      '<div class="stat"><div class="lbl">Expires</div><div class="desc" style="color:var(--text);font-size:14px">' +
      (k.used_at ? new Date((k.used_at + k.duration_days * 86400) * 1000).toLocaleString() : new Date((k.created_at + k.duration_days * 86400) * 1000).toLocaleString() + ' (from activation)') +
      '</div></div></div>' +
      '<h2 style="margin-top:20px;font-size:14px">Devices (' + ds.length + ')</h2>' + dTable +
      '</div>';

    document.body.appendChild(ov);
    ov.querySelector('#closeModal').onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  } catch (e) {
    toast('✗ Failed to load details');
  }
}

/* ============ PRICING ============ */
async function renderPricing(el) {
  const r = await fetchT('/api/pricing');
  const d = await r.json();
  const pricing = d.pricing || [];

  let rows = '';
  for (const p of pricing) {
    rows +=
      '<tr>' +
      '<td><b>' + p.duration_days + '</b> day' + (p.duration_days > 1 ? 's' : '') + '</td>' +
      '<td>' + (p.device_tier === 'unlimited' ? 'Unlimited' : p.device_tier + ' device') + '</td>' +
      '<td><b>' + p.credit_cost + '</b> cr</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button class="btn-icon edit" data-edit="' + p.id + '" data-cost="' + p.credit_cost + '" title="Edit">✏️</button>' +
      '<button class="btn-icon delete" data-del="' + p.id + '" title="Delete">🗑️</button>' +
      '</td></tr>';
  }
  if (!rows) rows = '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No pricing rules yet</td></tr>';

  el.innerHTML =
    '<h1>Pricing Configuration</h1>' +
    '<p class="muted" style="margin-bottom:20px">Owner-only. Sets how many credits each key costs.</p>' +
    '<div class="card"><h2>Add / Update Rule</h2>' +
    '<div class="grid">' +
    '<label>Duration (days)<input id="pDays" type="number" min="1" max="3650" placeholder="30"></label>' +
    '<label>Devices<select id="pTier"><option value="1">1 device</option><option value="2">2 devices</option><option value="unlimited">Unlimited</option></select></label>' +
    '<label>Credit cost<input id="pCost" type="number" min="0" placeholder="5"></label>' +
    '</div>' +
    '<button class="primary" id="pAdd" style="margin-top:8px">Save Rule</button></div>' +
    '<div class="card"><h2>Current Rules (' + pricing.length + ')</h2>' +
    '<div class="table-wrap"><table><thead><tr><th>Duration</th><th>Devices</th><th>Cost</th><th style="text-align:right">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

  el.querySelector('#pAdd').onclick = async () => {
    const duration_days = +el.querySelector('#pDays').value;
    const device_tier = el.querySelector('#pTier').value;
    const credit_cost = +el.querySelector('#pCost').value;
    const r2 = await fetchT('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_days, device_tier, credit_cost }),
    });
    const d2 = await r2.json();
    if (!r2.ok) return toast('✗ ' + d2.error);
    toast('✓ Rule saved');
    renderPricing(el);
  };

  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this rule?')) return;
    const r2 = await fetchT('/api/pricing/' + b.dataset.del, { method: 'DELETE' });
    if (!r2.ok) return toast('✗ failed');
    toast('✓ Deleted');
    renderPricing(el);
  });

  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const cost = prompt('New credit cost:', b.dataset.cost);
    if (cost === null) return;
    const r2 = await fetchT('/api/pricing/' + b.dataset.edit, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credit_cost: +cost }),
    });
    const d2 = await r2.json();
    if (!r2.ok) return toast('✗ ' + d2.error);
    toast('✓ Updated');
    renderPricing(el);
  });
}
views.pricing = renderPricing;

/* ============ CREDITS ============ */
async function renderCredits(el) {
  const rank = ROLE_RANK[ME.role] || 0;
  const canTransfer = rank >= ROLE_RANK.admin;
  const r = await fetchT('/api/auth/me');
  const mj = await r.json();
  ME.balance = mj.user.balance;
  document.getElementById('balanceVal').textContent = ME.balance;

  let tHTML = '';
  if (canTransfer) {
    tHTML =
      '<div class="card" style="margin-top:16px"><h2>Transfer Credits</h2>' +
      '<div class="grid"><label>Recipient<select id="txTo"></select></label><label>Amount<input id="txAmt" type="number" min="1" value="1"></label></div>' +
      '<button class="primary" id="txBtn" style="margin-top:8px">Send</button></div>';
  }

  el.innerHTML =
    '<h1>Credits</h1><p class="muted" style="margin-bottom:20px">Your available balance</p>' +
    '<div class="grid"><div class="stat"><div class="stat-icon">🪙</div><div class="lbl">Balance</div><div class="num">' + ME.balance + '</div><div class="desc">credits available</div></div></div>' +
    tHTML;

  if (!canTransfer) return;
  const ur = await fetchT('/api/users');
  const uj = await ur.json();
  const sel = el.querySelector('#txTo');
  for (const u of (uj.users || [])) {
    if (u.id === ME.id) continue;
    const o = document.createElement('option');
    o.value = u.id;
    o.textContent = u.username + ' (' + u.role + ')';
    sel.appendChild(o);
  }
  el.querySelector('#txBtn').onclick = async () => {
    const to_user_id = +sel.value;
    const amount = +el.querySelector('#txAmt').value;
    const r2 = await fetchT('/api/credits/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_user_id, amount }),
    });
    const d2 = await r2.json();
    if (!r2.ok) return toast('✗ ' + d2.error);
    toast('✓ Transfer complete');
    renderCredits(el);
  };
}
views.credits = renderCredits;

/* ============ USERS ============ */
async function renderUsers(el) {
  const r = await fetchT('/api/users');
  const d = await r.json();
  const users = d.users || [];
  const myRank = ROLE_RANK[ME.role] || 0;
  const canCreate = myRank >= ROLE_RANK.admin;
  const canDelete = myRank >= ROLE_RANK.admin;

  const roleOpts = [];
  if (myRank > ROLE_RANK.owner) roleOpts.push({ v: 'owner', l: 'Owner' });
  if (myRank > ROLE_RANK.admin) roleOpts.push({ v: 'admin', l: 'Admin' });
  if (myRank > ROLE_RANK.reseller) roleOpts.push({ v: 'reseller', l: 'Reseller' });

  let cHTML = '';
  if (canCreate) {
    cHTML =
      '<div class="card"><h2>Create User</h2><div class="grid">' +
      '<label>Username<input id="uName"></label>' +
      '<label>Password<input id="uPass" type="password"></label>' +
      '<label>Role<select id="uRole">' + roleOpts.map(o => '<option value="' + o.v + '">' + o.l + '</option>').join('') + '</select></label>' +
      '<label>Starting Balance<input id="uBal" type="number" value="0"></label>' +
      '</div><button class="primary" id="uBtn" style="margin-top:8px">Create User</button></div>';
  }

  let rows = '';
  for (const u of users) {
    rows +=
      '<tr><td>' + u.id + '</td><td>' + u.username + '</td>' +
      '<td><span class="badge role-' + u.role + '">' + u.role.replace(/_/g, ' ') + '</span></td>' +
      '<td>' + u.balance + '</td>' +
      '<td>' + (canDelete && u.id !== ME.id ? '<button class="danger small" data-del="' + u.id + '">Delete</button>' : '') + '</td></tr>';
  }

  el.innerHTML =
    '<h1>Users</h1><p class="muted" style="margin-bottom:20px">Manage accounts below your role</p>' +
    cHTML +
    '<div class="card"><h2>All Users</h2>' +
    '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Balance</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

  const ub = el.querySelector('#uBtn');
  if (ub) ub.onclick = async () => {
    const username = el.querySelector('#uName').value;
    const password = el.querySelector('#uPass').value;
    const role = el.querySelector('#uRole').value;
    const balance = +el.querySelector('#uBal').value;
    const r2 = await fetchT('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role, balance }),
    });
    const d2 = await r2.json();
    if (!r2.ok) return toast('✗ ' + d2.error);
    toast('✓ User created');
    renderUsers(el);
  };
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this user?')) return;
    const r2 = await fetchT('/api/users/' + b.dataset.del, { method: 'DELETE' });
    if (!r2.ok) return toast('✗ failed');
    toast('✓ Deleted');
    renderUsers(el);
  });
}
views.users = renderUsers;

/* ============ AUDIT ============ */
async function renderAudit(el) {
  const r = await fetchT('/api/audit?limit=200');
  const d = await r.json();
  const logs = d.logs || [];
  let rows = '';
  for (const l of logs) {
    rows +=
      '<tr><td>' + new Date(l.created_at * 1000).toLocaleString() + '</td>' +
      '<td>' + l.actor_username + ' <span class="muted">(' + l.actor_role + ')</span></td>' +
      '<td><code>' + l.action + '</code></td>' +
      '<td>' + (l.target || '—') + '</td>' +
      '<td>' + (l.ip || '—') + '</td></tr>';
  }
  el.innerHTML =
    '<h1>Audit Log</h1><p class="muted" style="margin-bottom:20px">Super Hide Owner actions are invisible.</p>' +
    '<div class="card"><div class="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}
views.audit = renderAudit;

/* ============ MASTER ============ */
async function renderMaster(el) {
  let prefix = 'DEMO';
  try {
    const r = await fetchT('/api/keys?per_page=1');
    const d = await r.json();
    if (d.prefix) prefix = d.prefix;
  } catch (e) {}

  el.innerHTML =
    '<h1>Master Controls</h1><p class="muted" style="margin-bottom:20px">Owner-only settings</p>' +
    '<div class="card"><h2>Global Prefix</h2><p class="muted">Currently: <code>' + prefix + '</code></p>' +
    '<div style="max-width:320px;margin-top:12px">' +
    '<label>New prefix (2–10 uppercase A–Z, 0–9)<input id="pfx" maxlength="10" value="' + prefix + '"></label>' +
    '<button class="primary" id="pfxBtn">Save Prefix</button></div></div>';

  el.querySelector('#pfxBtn').onclick = async () => {
    const prefix2 = el.querySelector('#pfx').value.trim().toUpperCase();
    const r = await fetchT('/api/keys/prefix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: prefix2 }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Prefix updated');
    renderMaster(el);
  };
}
views.master = renderMaster;

/* ============ API KEYS ============ */
async function renderApiKeys(el) {
  const r = await fetchT('/api/apikeys');
  const d = await r.json();
  const keys = d.apiKeys || [];

  let rows = '';
  for (const k of keys) {
    rows +=
      '<tr><td>' + k.name + '</td>' +
      '<td><code>' + k.key_prefix + '…</code></td>' +
      '<td>' + k.scopes + '</td>' +
      '<td>' + (k.active ? '<span class="badge ok">active</span>' : '<span class="badge danger">revoked</span>') + '</td>' +
      '<td>' + (k.active ? '<button class="ghost small" data-revoke="' + k.id + '">Revoke</button>' : '') +
      '<button class="danger small" data-del="' + k.id + '">Del</button></td></tr>';
  }

  el.innerHTML =
    '<h1>API Keys</h1><p class="muted" style="margin-bottom:20px">Used by external bots/sites</p>' +
    '<div class="card"><h2>Create API Key</h2><div class="grid">' +
    '<label>Name<input id="akName" placeholder="MyBot"></label>' +
    '<label>Scopes<select id="akScopes" multiple size="3">' +
    '<option value="verify" selected>verify</option>' +
    '<option value="keys:read">keys:read</option>' +
    '<option value="keys:write">keys:write</option>' +
    '<option value="credits">credits</option></select></label></div>' +
    '<button class="primary" id="akCreate" style="margin-top:8px">Create Key</button></div>' +
    '<div class="card"><h2>Your Keys</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

  el.querySelector('#akCreate').onclick = async () => {
    const name = el.querySelector('#akName').value.trim();
    const scopes = [...el.querySelector('#akScopes').selectedOptions].map(o => o.value);
    const res = await fetchT('/api/apikeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });
    const d2 = await res.json();
    if (!res.ok) return toast('✗ ' + d2.error);
    el.querySelector('#akCreate').insertAdjacentHTML('afterend',
      '<div class="card" style="margin-top:12px;border-color:var(--primary)"><b>Save this now — shown only once:</b>' +
      '<div style="margin-top:8px"><code style="user-select:all;font-size:13px">' + d2.key + '</code></div></div>');
    renderApiKeys(el);
  };
  el.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
    await fetchT('/api/apikeys/' + b.dataset.revoke + '/revoke', { method: 'POST' });
    renderApiKeys(el);
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this API key?')) return;
    await fetchT('/api/apikeys/' + b.dataset.del, { method: 'DELETE' });
    renderApiKeys(el);
  });
}
views.apikeys = renderApiKeys;

/* ============ API TESTER ============ */
async function renderApiTester(el) {
  let apiKey = null;
  try {
    const r = await fetchT('/api/apikeys/current');
    if (r.ok) {
      const d = await r.json();
      apiKey = d.apiKey;
    }
  } catch (e) {}
  const keyFull = apiKey && apiKey.full ? apiKey.full : '';

  el.innerHTML =
    '<h1>🧪 API Tester</h1>' +
    '<p class="muted" style="margin-bottom:20px">Test external API endpoints directly from the dashboard.</p>' +
    '<div class="card"><h2>Endpoint</h2>' +
    '<label>Select Endpoint<select id="epSelect">' +
    '<option value="check_balance">POST /check_balance</option>' +
    '<option value="reset_hwid">POST /reset_hwid</option>' +
    '<option value="generate_key">POST /generate_key</option>' +
    '<option value="delete_key">POST /delete_key</option>' +
    '<option value="register_device">POST /register_device</option>' +
    '</select></label>' +
    '<div id="epFields" style="margin-top:8px"></div>' +
    '<div class="row" style="margin-top:12px">' +
    '<button class="primary" id="testBtn">▶ Run Test</button>' +
    '<button class="ghost" id="clearBtn">✕ Clear</button>' +
    '</div></div>' +
    '<div class="card"><h2>Request Preview</h2>' +
    '<div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:6px">URL</div>' +
    '<pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;color:#c4b5fd;margin-bottom:14px"><code style="background:none;padding:0" id="previewUrl"></code></pre>' +
    '<div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:6px">Body</div>' +
    '<pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;color:#86efac"><code style="background:none;padding:0" id="previewBody"></code></pre></div>' +
    '<div class="card"><h2>Response</h2><div id="responseBlock" class="muted">No test run yet. Click "Run Test".</div></div>';

  const fld = el.querySelector('#epFields');
  const pu = el.querySelector('#previewUrl');
  const pb = el.querySelector('#previewBody');
  const rb = el.querySelector('#responseBlock');

  const f = (id, label, ph) => '<label>' + label + '<input id="' + id + '" placeholder="' + (ph || '') + '" autocomplete="off"></label>';

  function renderFields() {
    const ep = el.querySelector('#epSelect').value;
    if (ep === 'check_balance') fld.innerHTML = '<p class="muted">No extra fields — API key added automatically.</p>';
    else if (ep === 'reset_hwid') fld.innerHTML = f('f_key', 'License Key', 'ALIYA-XXXX-XXXX-XXXX');
    else if (ep === 'generate_key') fld.innerHTML =
      '<div class="grid">' + f('f_days', 'Days', '30') + f('f_count', 'Count (max 10)', '1') + f('f_device', 'Device (1/2/unlimited)', '1') + '</div>';
    else if (ep === 'delete_key') fld.innerHTML = f('f_key', 'License Key', 'ALIYA-XXXX-XXXX-XXXX');
    else if (ep === 'register_device') fld.innerHTML =
      '<div class="grid">' + f('f_key', 'License Key', 'ALIYA-XXXX-XXXX-XXXX') + f('f_hwid', 'Device HWID', 'device-123') + '</div>';
    updPreview();
  }

  function buildBody() {
    const ep = el.querySelector('#epSelect').value;
    const body = { api_key: keyFull };
    if (ep === 'reset_hwid' || ep === 'delete_key') {
      const el1 = el.querySelector('#f_key');
      body.key = el1 ? el1.value.trim() : '';
    } else if (ep === 'generate_key') {
      body.days = +(el.querySelector('#f_days') || {}).value || 30;
      body.count = +(el.querySelector('#f_count') || {}).value || 1;
      body.device = ((el.querySelector('#f_device') || {}).value || '1').trim();
    } else if (ep === 'register_device') {
      body.key = ((el.querySelector('#f_key') || {}).value || '').trim();
      body.hwid = ((el.querySelector('#f_hwid') || {}).value || '').trim();
    }
    return body;
  }

  function updPreview() {
    const ep = el.querySelector('#epSelect').value;
    pu.textContent = location.origin + '/api/external/' + ep;
    pb.textContent = JSON.stringify(buildBody(), null, 2);
  }

  el.querySelector('#epSelect').onchange = renderFields;
  renderFields();

  el.querySelector('#testBtn').onclick = async () => {
    const ep = el.querySelector('#epSelect').value;
    const body = buildBody();
    rb.innerHTML = '<p class="muted">⏳ Sending…</p>';
    try {
      const res = await fetchT('/api/external/' + ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 25000);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
      const col = res.ok ? 'var(--ok)' : 'var(--danger)';
      rb.innerHTML =
        '<div class="row" style="margin-bottom:10px"><span class="badge" style="background:' + col + ';color:#fff;border:none">' + res.status + '</span>' +
        '<span class="muted">' + ep + '</span></div>' +
        '<pre style="background:rgba(0,0,0,0.4);padding:14px;border-radius:10px;overflow-x:auto;font-size:12.5px;color:#86efac;white-space:pre-wrap"><code style="background:none;padding:0">' + pretty + '</code></pre>';
    } catch (e) {
      rb.innerHTML = '<div class="card" style="border-color:var(--danger)"><h2 style="font-size:14px;color:#fca5a5">✗ Failed</h2><p class="muted">' + e.message + '</p></div>';
    }
  };

  el.querySelector('#clearBtn').onclick = () => {
    renderFields();
    rb.innerHTML = '<p class="muted">No test run yet.</p>';
  };
}
views.apitester = renderApiTester;

/* ============ API DOCS ============ */
async function renderApiDocs(el) {
  const origin = location.origin;
  const baseUrl = origin + '/api/external';

  let apiKey = null;
  try {
    const r = await fetchT('/api/apikeys/current');
    if (r.ok) { const d = await r.json(); apiKey = d.apiKey; }
  } catch (e) {}

  const keyDisplay = apiKey && apiKey.full ? apiKey.full : 'Loading…';

  el.innerHTML =
    '<h1>API Documentation</h1><p class="muted" style="margin-bottom:20px">REST endpoints for external integrations.</p>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
    '<div style="background:linear-gradient(90deg,#3b82f6,#6366f1);padding:16px 20px;display:flex;align-items:center;gap:12px">' +
    '<span style="font-size:18px">🛡️</span><span style="font-weight:900;letter-spacing:0.8px;font-size:14px">AUTHENTICATION</span></div>' +
    '<div style="padding:20px"><p style="line-height:1.7">All API requests must include <code>api_key</code> in body OR <code>X-API-Key</code> header.</p>' +
    '<div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin:18px 0 8px">Base URL</div>' +
    '<pre style="background:rgba(0,0,0,0.35);padding:14px;border-radius:10px;overflow-x:auto;font-size:12.5px;color:#86efac"><code style="background:none;padding:0">' + baseUrl + '</code></pre></div></div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
    '<div style="background:linear-gradient(90deg,#7c3aed,#a855f7);padding:16px 20px;display:flex;align-items:center;gap:12px">' +
    '<span style="font-size:18px">🔑</span><span style="font-weight:900;letter-spacing:0.8px;font-size:14px">CONFIGURATION &amp; API KEY</span></div>' +
    '<div style="padding:20px">' +
    '<div style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1.2px;font-weight:900;margin-bottom:10px">Your API Key</div>' +
    '<div style="display:flex;gap:12px;align-items:stretch;flex-wrap:wrap">' +
    '<pre style="flex:1;min-width:240px;background:rgba(0,0,0,0.4);padding:16px;border-radius:12px;overflow-x:auto;font-size:13.5px;color:#86efac;margin:0;font-family:ui-monospace,monospace;font-weight:600"><code style="background:none;padding:0">' + keyDisplay + '</code></pre>' +
    '<button class="primary" id="copyApiKey" style="align-self:stretch;min-width:100px">📋 Copy</button></div>' +
    '<div style="margin-top:18px"><button class="primary" id="regenApiKey">🔄 Generate New API Key</button></div>' +
    '<p class="muted" style="margin-top:16px;font-size:12.5px;line-height:1.7">⚠️ Keep this key safe. Regenerating invalidates the old key.</p>' +
    '</div></div>' +
    '<div class="card"><h2>Endpoints</h2>' +
    '<ul style="margin-left:20px;line-height:2;color:var(--text-2);font-size:13.5px">' +
    '<li><code>POST /check_balance</code> — Verify your balance</li>' +
    '<li><code>POST /reset_hwid</code> — Reset a license key device</li>' +
    '<li><code>POST /generate_key</code> — Generate new license keys</li>' +
    '<li><code>POST /delete_key</code> — Delete license keys</li>' +
    '<li><code>POST /register_device</code> — Register unlimited device</li>' +
    '</ul></div>';

  el.querySelector('#copyApiKey')?.addEventListener('click', async () => {
    if (!apiKey || !apiKey.full) return toast('✗ No key');
    try { await navigator.clipboard.writeText(apiKey.full); toast('✓ Copied'); }
    catch (e) { toast('✗ Copy failed'); }
  });
  el.querySelector('#regenApiKey')?.addEventListener('click', async () => {
    if (!confirm('Regenerate API key? Old key stops working.')) return;
    const r = await fetchT('/api/apikeys/regenerate', { method: 'POST' });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ New key generated');
    renderApiDocs(el);
  });
}
views.apidocs = renderApiDocs;

/* ============ SETTINGS ============ */
async function renderSettings(el) {
  const rank = ROLE_RANK[ME.role] || 0;
  const canEditBranding = rank >= ROLE_RANK.owner;
  const canManageLinks = rank >= ROLE_RANK.admin;
  const canManageMaster = rank >= ROLE_RANK.owner;

  let branding = { brand_name: '', brand_logo: '', brand_tagline: '', brand_footer: '', brand_color: '#7c3aed' };
  try {
    const r = await fetchT('/api/branding');
    branding = await r.json();
  } catch (e) {}

  let links = [];
  if (canManageLinks) {
    try {
      const r = await fetchT('/api/reset-links');
      const d = await r.json();
      links = d.links || [];
    } catch (e) {}
  }
  const myLinks = links.filter(l => !l.is_master);
  const masterLinks = links.filter(l => l.is_master);

  const isImg = branding.brand_logo && branding.brand_logo.startsWith('data:image/');
  const logoPreview = isImg
    ? '<img src="' + branding.brand_logo + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:12px">'
    : '<span style="font-size:36px">' + (branding.brand_logo || '👑') + '</span>';

  let linksHTML = '';
  if (canManageLinks) {
    let rows = '';
    for (const l of myLinks) {
      rows +=
        '<tr><td><code>' + l.token.slice(0, 16) + '…</code></td>' +
        '<td>' + (l.note || '—') + '</td>' +
        '<td>' + l.uses + (l.max_uses ? ' / ' + l.max_uses : '') + '</td>' +
        '<td>' + new Date(l.created_at * 1000).toLocaleDateString() + '</td>' +
        '<td style="text-align:right"><button class="btn-icon edit" data-copy="' + l.token + '">📋</button>' +
        '<button class="btn-icon delete" data-rm="' + l.id + '">🗑️</button></td></tr>';
    }
    if (!rows) rows = '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No reset links yet</td></tr>';

    linksHTML =
      '<div class="card"><h2>🔗 My Reset Links</h2>' +
      '<p class="muted" style="margin-bottom:14px">Each link resets ONLY keys that belong to you.</p>' +
      '<div class="grid"><label>Note (optional)<input id="rlNote" placeholder="e.g. For Ahmed" maxlength="80"></label>' +
      '<label>Max uses (optional)<input id="rlMaxUses" type="number" min="1" placeholder="unlimited"></label></div>' +
      '<button class="primary" id="rlCreate" style="margin-top:8px">🔗 Create My Reset Link</button>' +
      '<div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>Link</th><th>Note</th><th>Uses</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  let masterHTML = '';
  if (canManageMaster) {
    let rows = '';
    for (const l of masterLinks) {
      rows +=
        '<tr><td><code>' + l.token.slice(0, 16) + '…</code></td>' +
        '<td>' + (l.note || '—') + '</td>' +
        '<td>' + l.uses + (l.max_uses ? ' / ' + l.max_uses : '') + '</td>' +
        '<td>' + new Date(l.created_at * 1000).toLocaleDateString() + '</td>' +
        '<td style="text-align:right"><button class="btn-icon edit" data-copy="' + l.token + '">📋</button>' +
        '<button class="btn-icon delete" data-rm="' + l.id + '">🗑️</button></td></tr>';
    }
    if (!rows) rows = '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No master link yet</td></tr>';

    masterHTML =
      '<div class="card" style="border-color:rgba(239,68,68,0.5);background:rgba(239,68,68,0.04)">' +
      '<h2>🌐 Master Reset Link (Owner Only)</h2>' +
      '<p class="muted" style="margin-bottom:14px;color:#fca5a5">⚠️ Resets ANY key on the entire site.</p>' +
      '<button class="danger" id="rlMasterCreate">🌐 Generate Master Reset Link</button>' +
      '<div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>Master Link</th><th>Note</th><th>Uses</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  let brandHTML = '';
  if (canEditBranding) {
    brandHTML =
      '<div class="card"><h2>🎨 Branding</h2>' +
      '<p class="muted" style="margin-bottom:18px">These fields appear on login/reset pages & dashboard.</p>' +
      '<div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px">' +
      '<div style="flex-shrink:0;text-align:center">' +
      '<div id="logoPreview" style="width:96px;height:96px;border-radius:20px;background:linear-gradient(135deg,var(--primary),var(--accent));display:grid;place-items:center;overflow:hidden">' + logoPreview + '</div>' +
      '<p class="muted" style="margin-top:8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800">Preview</p></div>' +
      '<div style="flex:1;min-width:220px">' +
      '<label>Upload Logo Image (PNG/JPG)<input type="file" id="bLogoFile" accept="image/png,image/jpeg,image/webp,image/gif"></label>' +
      '<p class="muted" style="margin:-6px 0 12px 0;font-size:11px">Max ~500KB. Will be resized.</p>' +
      '<label>Or use Emoji<input id="bLogo" maxlength="8" value="' + (isImg ? '' : (branding.brand_logo || '👑')) + '" placeholder="👑"></label>' +
      '<button class="ghost" id="clearLogo" style="margin-top:4px">✕ Clear Image</button></div></div>' +
      '<div class="grid">' +
      '<label>Brand Name<input id="bName" maxlength="64" value="' + branding.brand_name + '"></label>' +
      '<label>Tagline<input id="bTagline" maxlength="96" value="' + branding.brand_tagline + '"></label>' +
      '<label>Footer<input id="bFooter" maxlength="96" value="' + branding.brand_footer + '"></label>' +
      '<label>Accent Color<input id="bColor" maxlength="7" value="' + branding.brand_color + '"></label>' +
      '</div><div class="row" style="margin-top:8px">' +
      '<button class="primary" id="saveBranding">💾 Save Branding</button>' +
      '<button class="ghost" id="resetBranding">↺ Reset Default</button></div></div>';
  }

  el.innerHTML =
    '<h1>Settings</h1><p class="muted" style="margin-bottom:20px">Manage your account & site</p>' +
    '<div class="card"><h2>Profile</h2><div class="grid">' +
    '<label>Username<input value="' + ME.username + '" disabled></label>' +
    '<label>Role<input value="' + ME.role.replace(/_/g, ' ') + '" disabled></label>' +
    '<label>Balance<input value="' + ME.balance + '" disabled></label></div></div>' +
    linksHTML + masterHTML + brandHTML;

  let pendingLogo = null;

  const fileInput = el.querySelector('#bLogoFile');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('✗ Image too large (max 2MB)'); fileInput.value = ''; return; }
      try {
        const url = await resizeImage(f, 256, 256);
        pendingLogo = url;
        const prev = el.querySelector('#logoPreview');
        prev.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:100%;object-fit:contain">';
        toast('✓ Image ready — click Save');
      } catch (err) {
        toast('✗ Failed to load image');
      }
    });
  }

  el.querySelector('#clearLogo')?.addEventListener('click', () => {
    pendingLogo = 'CLEAR';
    const prev = el.querySelector('#logoPreview');
    prev.innerHTML = '<span style="font-size:36px">👑</span>';
    if (fileInput) fileInput.value = '';
    el.querySelector('#bLogo').value = '👑';
    toast('✓ Will clear on save');
  });

  el.querySelector('#rlCreate')?.addEventListener('click', async () => {
    const note = el.querySelector('#rlNote').value.trim();
    const raw = el.querySelector('#rlMaxUses').value.trim();
    const max_uses = raw ? parseInt(raw, 10) : '';
    const r = await fetchT('/api/reset-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, max_uses }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    const url = location.origin + d.url;
    try { await navigator.clipboard.writeText(url); toast('✓ Created & copied!'); }
    catch (e) { prompt('Copy URL:', url); }
    renderSettings(el);
  });

  el.querySelector('#rlMasterCreate')?.addEventListener('click', async () => {
    if (!confirm('Create MASTER reset link? Resets ANY key.')) return;
    const note = prompt('Note (optional):', 'Master Link') || '';
    const r = await fetchT('/api/reset-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, is_master: true }),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    const url = location.origin + d.url;
    try { await navigator.clipboard.writeText(url); toast('✓ Master link created & copied!'); }
    catch (e) { prompt('Copy URL:', url); }
    renderSettings(el);
  });

  el.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    const url = location.origin + '/reset.html?token=' + b.dataset.copy;
    try { await navigator.clipboard.writeText(url); toast('✓ Copied'); }
    catch (e) { prompt('Copy:', url); }
  });

  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this reset link?')) return;
    const r = await fetchT('/api/reset-links/' + b.dataset.rm, { method: 'DELETE' });
    if (!r.ok) return toast('✗ failed');
    toast('✓ Deleted');
    renderSettings(el);
  });

  el.querySelector('#saveBranding')?.addEventListener('click', async () => {
    const payload = {
      brand_name: el.querySelector('#bName').value.trim(),
      brand_tagline: el.querySelector('#bTagline').value.trim(),
      brand_footer: el.querySelector('#bFooter').value.trim(),
      brand_color: el.querySelector('#bColor').value.trim(),
    };
    if (pendingLogo === 'CLEAR') payload.brand_logo = '👑';
    else if (pendingLogo) payload.brand_logo = pendingLogo;
    else {
      const em = el.querySelector('#bLogo').value.trim();
      if (em) payload.brand_logo = em;
    }
    const r = await fetchT('/api/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return toast('✗ ' + d.error);
    toast('✓ Branding updated');
    await loadBranding();
    renderSettings(el);
  });

  el.querySelector('#resetBranding')?.addEventListener('click', async () => {
    if (!confirm('Reset branding to defaults?')) return;
    await fetchT('/api/branding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand_name: 'YOUR BRAND NAME', brand_logo: '👑',
        brand_tagline: 'License Management System',
        brand_footer: 'SECURITY v2.0', brand_color: '#7c3aed',
      }),
    });
    toast('✓ Reset');
    await loadBranding();
    renderSettings(el);
  });
}
views.settings = renderSettings;

/* ============ HELPERS ============ */
function resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/png', 0.9));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============ START ============ */
boot();
