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
