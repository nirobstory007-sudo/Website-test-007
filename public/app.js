async function renderApiDocs(el) {
  const origin = location.origin;
  const baseUrl = `${origin}/api/external`;

  // fetch user's api keys to show prefix
  let apiKeys = [];
  try { apiKeys = (await fetch('/api/apikeys').then(r => r.json())).apiKeys || []; } catch {}
  const firstKey = apiKeys.find(k => k.active);

  const endpoint = (method, color, title, url, body, resp, curl) => `
    <div class="card" style="padding:0;overflow:hidden;margin-top:16px">
      <div style="background:${color};padding:12px 18px;display:flex;align-items:center;gap:12px">
        <span style="background:rgba(0,0,0,0.35);padding:3px 10px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:1px">${method}</span>
        <span style="font-weight:800;letter-spacing:0.5px;font-size:14px">${title}</span>
      </div>
      <div style="padding:18px">
        <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;font-weight:700;margin-bottom:6px">URL</div>
        <pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12.5px;color:#c4b5fd;margin-bottom:16px"><code style="background:none;padding:0">${url}</code></pre>

        <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;font-weight:700;margin-bottom:6px">Parameters (POST / JSON body)</div>
        <div class="table-wrap" style="margin-bottom:16px">
          <table>
            <thead><tr><th>Parameter</th><th>Type</th><th>Information</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>

        <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;font-weight:700;margin-bottom:6px">Example Response</div>
        <pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;color:#86efac;margin-bottom:16px"><code style="background:none;padding:0">${resp}</code></pre>

        <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;font-weight:700;margin-bottom:6px">Example (cURL)</div>
        <pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12px;color:#c4b5fd"><code style="background:none;padding:0">${curl}</code></pre>
      </div>
    </div>
  `;

  el.innerHTML = `
    <h1>API Documentation</h1>
    <p class="muted" style="margin-bottom:20px">REST endpoints for external integrations. Available for all roles.</p>

    <!-- AUTHENTICATION -->
    <div class="card" style="padding:0;overflow:hidden">
      <div style="background:linear-gradient(90deg,#3b82f6,#6366f1);padding:12px 18px;display:flex;align-items:center;gap:10px">
        <span style="font-size:16px">🛡️</span>
        <span style="font-weight:800;letter-spacing:0.5px">AUTHENTICATION</span>
      </div>
      <div style="padding:18px">
        <p>All API requests must include <code>api_key</code> in the request body OR as <code>X-API-Key</code> header.</p>
        <div class="lbl" style="font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:1px;font-weight:700;margin:14px 0 6px">Base URL</div>
        <pre style="background:rgba(0,0,0,0.35);padding:12px;border-radius:8px;overflow-x:auto;font-size:12.5px;color:#86efac"><code style="background:none;padding:0">${baseUrl}</code></pre>
      </div>
    </div>

    <!-- API KEY -->
    <div class="card" style="padding:0;overflow:hidden">
      <div style="background:linear-gradient(90deg,#7c3aed,#a855f7);padding:12px 18px;display:flex;align-items:center;gap:10px">
        <span style="font-size:16px">🔑</span>
        <span style="font-weight:800;letter-spacing:0.5px">YOUR API KEY</span>
      </div>
      <div style="padding:18px">
        ${firstKey ? `
          <p class="muted">Prefix: <code>${firstKey.key_prefix}…</code></p>
          <p class="muted" style="margin-top:6px">Scopes: <b>${firstKey.scopes}</b></p>
          <p class="muted" style="margin-top:6px">Full key was shown only once when created. If lost, revoke and create a new one.</p>
        ` : `<p class="muted">You don't have any API keys yet. Go to <b>API Keys</b> in the sidebar to create one.</p>`}
      </div>
    </div>

    ${endpoint('POST', 'linear-gradient(90deg,#f97316,#ea580c)', 'ENDPOINT: RESET KEY HWID', `${baseUrl}/reset_hwid`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>
       <tr><td><code>key</code></td><td>string</td><td>License key whose HWID to reset</td></tr>`,
      `{
  "status": "success",
  "message": "Hardware identifier has been reset successfully.",
  "key": "DEMO-XXXX-XXXX-XXXX"
}`,
      `curl -X POST ${baseUrl}/reset_hwid \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"key":"DEMO-XXXX-XXXX-XXXX"}'`
    )}

    ${endpoint('POST', 'linear-gradient(90deg,#10b981,#059669)', 'ENDPOINT: GENERATE KEY', `${baseUrl}/generate_key`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>
       <tr><td><code>days</code></td><td>int</td><td>License duration in days (must match a pricing rule)</td></tr>
       <tr><td><code>count</code></td><td>int</td><td>Number of keys to generate (max 10)</td></tr>
       <tr><td><code>device</code></td><td>string</td><td><code>1</code> · <code>2</code> · <code>unlimited</code> (optional, default 1)</td></tr>`,
      `{
  "status": "success",
  "keys": ["DEMO-AB12-CD34-EF56"],
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
  "deleted_keys": ["KEY001", "KEY002"],
  "not_found": ["KEY999"],
  "skipped": ["KEY003"]
}`,
      `curl -X POST ${baseUrl}/delete_key \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"keys":["KEY001","KEY002","KEY003"]}'`
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
  -d '{"key":"DEMO-XXXX-XXXX-XXXX","hwid":"dev-abc-123"}'`
    )}

    ${endpoint('POST', 'linear-gradient(90deg,#ef4444,#dc2626)', 'ENDPOINT: CHECK BALANCE', `${baseUrl}/check_balance`,
      `<tr><td><code>api_key</code></td><td>string</td><td>Your API Key</td></tr>`,
      `{
  "status": "success",
  "username": "reseller1",
  "credits": 150,
  "role": "reseller"
}`,
      `curl -X POST ${baseUrl}/check_balance \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY"`
    )}

    <!-- NOTE -->
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
}
