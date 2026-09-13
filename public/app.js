async function renderUsers(el) {
  const { users } = await fetch('/api/users').then(r => r.json());
  const myRank = ROLE_RANK[ME.role];
  const canCreate = myRank >= ROLE_RANK.admin;
  const canDelete = myRank >= ROLE_RANK.admin;

  /* Build available role options based on who's logged in */
  const roleOptions = [];
  if (myRank > ROLE_RANK.owner)  roleOptions.push({ v: 'owner',    l: 'Owner' });
  if (myRank > ROLE_RANK.admin)  roleOptions.push({ v: 'admin',    l: 'Admin' });
  if (myRank > ROLE_RANK.reseller) roleOptions.push({ v: 'reseller', l: 'Reseller' });

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
