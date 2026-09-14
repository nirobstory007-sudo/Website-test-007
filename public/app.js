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

  const isImageLogo = branding.brand_logo && branding.brand_logo.startsWith('data:image/');
  const logoPreviewHTML = isImageLogo
    ? `<img src="${branding.brand_logo}" alt="Logo" style="max-width:100%;max-height:100%;border-radius:12px;object-fit:contain">`
    : `<span style="font-size:36px">${branding.brand_logo || '👑'}</span>`;

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
      <p class="muted" style="margin-bottom:18px">These fields appear on login page, reset page & dashboard.</p>

      <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px">
        <div style="flex-shrink:0;text-align:center">
          <div id="logoPreview" style="width:96px;height:96px;border-radius:20px;
              background:linear-gradient(135deg,var(--primary),var(--accent));
              display:grid;place-items:center;overflow:hidden;
              box-shadow:0 8px 20px rgba(124,58,237,0.35)">
            ${logoPreviewHTML}
          </div>
          <p class="muted" style="margin-top:8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800">Logo Preview</p>
        </div>

        <div style="flex:1;min-width:220px">
          <label>Upload Logo Image (PNG / JPG)
            <input type="file" id="bLogoFile" accept="image/png,image/jpeg,image/webp,image/gif" style="padding:10px">
          </label>
          <p class="muted" style="margin:-6px 0 12px 0;font-size:11px">Max ~500KB. Will be resized on upload.</p>

          <label>Or use Emoji
            <input id="bLogo" maxlength="8" value="${isImageLogo ? '' : (branding.brand_logo || '👑')}" placeholder="👑">
          </label>

          <button class="ghost" id="clearLogo" style="margin-top:4px">✕ Clear Logo Image</button>
        </div>
      </div>

      <div class="grid">
        <label>Brand Name<input id="bName" maxlength="64" value="${branding.brand_name}"></label>
        <label>Tagline<input id="bTagline" maxlength="96" value="${branding.brand_tagline}"></label>
        <label>Footer<input id="bFooter" maxlength="96" value="${branding.brand_footer}"></label>
        <label>Accent Color<input id="bColor" maxlength="7" value="${branding.brand_color}"></label>
      </div>

      <div class="row" style="margin-top:8px">
        <button class="primary" id="saveBranding">💾 Save Branding</button>
        <button class="ghost" id="resetBranding">↺ Reset to Default</button>
      </div>
    </div>` : ''}
  `;

  /* -------- Image upload preview + resize -------- */
  let pendingLogoDataUrl = null;
  const fileInput = el.querySelector('#bLogoFile');
  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast('✗ Image too large (max 2MB before resize)');
      fileInput.value = '';
      return;
    }
    try {
      const dataUrl = await resizeImageFile(file, 256, 256);
      pendingLogoDataUrl = dataUrl;
      const prev = el.querySelector('#logoPreview');
      prev.innerHTML = `<img src="${dataUrl}" alt="Logo" style="max-width:100%;max-height:100%;object-fit:contain">`;
      toast('✓ Image ready — click Save Branding');
    } catch (err) {
      toast('✗ Failed to load image');
    }
  });

  el.querySelector('#clearLogo')?.addEventListener('click', () => {
    pendingLogoDataUrl = 'CLEAR';
    const prev = el.querySelector('#logoPreview');
    prev.innerHTML = `<span style="font-size:36px">👑</span>`;
    if (fileInput) fileInput.value = '';
    el.querySelector('#bLogo').value = '👑';
    toast('✓ Will clear on save');
  });

  /* -------- Reset links handlers (unchanged) -------- */
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

  /* -------- Save branding (with image) -------- */
  el.querySelector('#saveBranding')?.addEventListener('click', async () => {
    const payload = {
      brand_name: el.querySelector('#bName').value.trim(),
      brand_tagline: el.querySelector('#bTagline').value.trim(),
      brand_footer: el.querySelector('#bFooter').value.trim(),
      brand_color: el.querySelector('#bColor').value.trim(),
    };

    if (pendingLogoDataUrl === 'CLEAR') {
      payload.brand_logo = '👑';
    } else if (pendingLogoDataUrl) {
      payload.brand_logo = pendingLogoDataUrl;
    } else {
      const emoji = el.querySelector('#bLogo').value.trim();
      if (emoji) payload.brand_logo = emoji;
    }

    const r = await fetchT('/api/branding', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
async function resizeImageFile(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        const w = Math.round(width * ratio);
        const h = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        // PNG with transparency preferred
        resolve(canvas.toDataURL('image/png', 0.9));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}
