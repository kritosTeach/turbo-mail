const SmtpManager = {
  // أضف هذا الزر بجانب زر "Add Server" في دالة render
// <button onclick="SmtpManager.showBulkImportModal()" class="btn btn-secondary"><i class="fas fa-file-import"></i> Bulk Import</button>

showBulkImportModal() {
  App.showModal(`
    <h3 class="text-lg font-semibold mb-4">Bulk SMTP Import</h3>
    <div class="space-y-4">
      <p class="text-xs text-gray-400">Paste your SMTPs in format: <code>host|port|username|password</code> (one per line)</p>
      <textarea id="bulk-smtp-input" class="textarea font-mono text-xs" rows="10" placeholder="mail.example.com|465|user@example.com|password123"></textarea>
      
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Default Encryption</label>
          <select id="bulk-encryption" class="input text-sm">
            <option value="ssl">SSL (Port 465)</option>
            <option value="tls">TLS/STARTTLS (Port 587)</option>
            <option value="none">None</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Default Priority</label>
          <input type="number" id="bulk-priority" class="input text-sm" value="10">
        </div>
      </div>

      <button onclick="SmtpManager.processBulkImport()" class="btn btn-primary w-full justify-center">
        <i class="fas fa-upload"></i> Process & Save
      </button>
    </div>
  `);
},

async processBulkImport() {
  const input = document.getElementById('bulk-smtp-input').value;
  const encryption = document.getElementById('bulk-encryption').value;
  const priority = parseInt(document.getElementById('bulk-priority').value);
  
  const lines = input.split('\n').filter(line => line.trim().includes('|'));
  const smtps = lines.map(line => {
    const [host, port, user, pass] = line.split('|');
    return {
      name: host,
      host: host.trim(),
      port: parseInt(port.trim()),
      username: user.trim(),
      password: pass.trim(),
      encryption: encryption,
      auth_method: 'login',
      priority: priority
    };
  });

  if (smtps.length === 0) {
    App.showToast('No valid SMTP format found', 'error');
    return;
  }

  try {
    App.showLoading(true);
    const res = await fetch('/api/smtp/bulk', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${App.state.token}` 
      },
      body: JSON.stringify({ smtps })
    });
    
    if (res.ok) {
      const data = await res.json();
      App.closeModal();
      App.showToast(`Successfully imported ${data.count} SMTP servers`, 'success');
      SmtpManager.load();
    } else {
      throw new Error('Bulk import failed');
    }
  } catch(e) {
    App.showToast(e.message, 'error');
  } finally {
    App.showLoading(false);
  }
},
    async render() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">SMTP Manager</h2>
            <p class="text-gray-500 text-sm">Manage your SMTP relay servers</p>
          </div>
          <button onclick="SmtpManager.showBulkImportModal()" class="btn btn-secondary"><i class="fas fa-file-import"></i> Bulk Import</button>
            <button onclick="SmtpManager.showAddModal()" class="btn btn-primary"><i class="fas fa-plus"></i> Add Server</button>
        </div>
        <div class="card">
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Name</th><th>Host</th><th>Port</th><th>Encryption</th><th>Auth</th><th>Priority</th><th>Status</th><th>Failures</th><th>Actions</th></tr>
              </thead>
              <tbody id="smtp-table-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    await this.load();
  },
    
  async load() {
    try {
      const res = await fetch('/api/smtp', {
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();
      const tbody = document.getElementById('smtp-table-body');
      tbody.innerHTML = (data.smtp_servers || []).map(s => `
        <tr>
          <td class="font-medium">${s.name}</td>
          <td class="font-mono text-sm">${s.host}</td>
          <td>${s.port}</td>
          <td><span class="badge badge-info">${s.encryption || 'none'}</span></td>
          <td><span class="badge badge-${s.auth_method === 'none' ? 'warning' : 'neutral'}">${s.auth_method || 'login'}</span></td>
          <td>${s.priority}</td>
          <td><span class="badge badge-${s.is_active ? 'success' : 'danger'}">${s.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>${s.fail_count}</td>
          <td>
            <div class="flex gap-1">
              <button onclick="SmtpManager.test('${s.id}')" class="btn btn-sm btn-success" title="Test Connection"><i class="fas fa-plug"></i></button>
              <button onclick="SmtpManager.showEditModal('${s.id}')" class="btn btn-sm btn-secondary" title="Edit"><i class="fas fa-edit"></i></button>
              <button onclick="SmtpManager.deleteServer('${s.id}')" class="btn btn-sm btn-danger" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch(e) { App.showToast('Failed to load SMTP servers', 'error'); }
  },

  showAddModal() {
    App.showModal(`
      <h3 class="text-lg font-semibold mb-4">Add SMTP Server</h3>
      <form id="smtp-form" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Name *</label>
            <input type="text" id="smtp-name" class="input" required placeholder="My SMTP">
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Host *</label>
            <input type="text" id="smtp-host" class="input" required placeholder="smtp.example.com">
          </div>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Port *</label>
            <input type="number" id="smtp-port" class="input" value="587" required>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Encryption</label>
            <select id="smtp-encryption" class="input">
              <option value="tls">TLS</option>
              <option value="ssl">SSL</option>
              <option value="starttls">STARTTLS</option>
              <option value="none">None</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Auth Method</label>
            <select id="smtp-auth" class="input" onchange="SmtpManager.toggleAuthFields()">
              <option value="login">Login</option>
              <option value="anonymous">Anonymous</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
        <div id="auth-fields" class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Username</label>
            <input type="text" id="smtp-username" class="input" placeholder="SMTP username">
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Password</label>
            <input type="password" id="smtp-password" class="input" placeholder="SMTP password">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Priority (lower = higher)</label>
            <input type="number" id="smtp-priority" class="input" value="0">
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Max Connections</label>
            <input type="number" id="smtp-max-conn" class="input" value="5">
          </div>
        </div>
        <button type="submit" class="btn btn-primary w-full justify-center">
          <i class="fas fa-save"></i> Add Server
        </button>
      </form>
    `);

    document.getElementById('smtp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await SmtpManager.save();
    });
  },

  toggleAuthFields() {
    const auth = document.getElementById('smtp-auth').value;
    document.getElementById('auth-fields').style.display = (auth === 'login') ? 'grid' : 'none';
  },

  async save(id) {
    const payload = {
      name: document.getElementById('smtp-name').value,
      host: document.getElementById('smtp-host').value,
      port: parseInt(document.getElementById('smtp-port').value),
      encryption: document.getElementById('smtp-encryption').value,
      auth_method: document.getElementById('smtp-auth').value,
      username: document.getElementById('smtp-username').value || null,
      password: document.getElementById('smtp-password').value || null,
      priority: parseInt(document.getElementById('smtp-priority').value) || 0,
      max_connections: parseInt(document.getElementById('smtp-max-conn').value) || 5
    };

    try {
      const url = id ? `/api/smtp/${id}` : '/api/smtp';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        App.closeModal();
        App.showToast(id ? 'SMTP server updated' : 'SMTP server added', 'success');
        SmtpManager.load();
      } else throw new Error(data.error);
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  showEditModal(id) {
    fetch(`/api/smtp/${id}`, {
      headers: { 'Authorization': `Bearer ${App.state.token}` }
    }).then(r => r.json()).then(data => {
      const s = data.smtp_server;
      App.showModal(`
        <h3 class="text-lg font-semibold mb-4">Edit SMTP Server</h3>
        <form id="smtp-form" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Name</label><input type="text" id="smtp-name" class="input" value="${s.name}"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Host</label><input type="text" id="smtp-host" class="input" value="${s.host}"></div>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div><label class="block text-sm text-gray-400 mb-1">Port</label><input type="number" id="smtp-port" class="input" value="${s.port}"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Encryption</label><select id="smtp-encryption" class="input">${['tls','ssl','starttls','none'].map(o => `<option value="${o}" ${s.encryption === o ? 'selected' : ''}>${o.toUpperCase()}</option>`).join('')}</select></div>
            <div><label class="block text-sm text-gray-400 mb-1">Auth</label><select id="smtp-auth" class="input">${['login','anonymous','none'].map(o => `<option value="${o}" ${s.auth_method === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          </div>
          <div id="auth-fields" class="grid grid-cols-2 gap-4" style="display:${s.auth_method === 'login' ? 'grid' : 'none'}">
            <div><label class="block text-sm text-gray-400 mb-1">Username</label><input type="text" id="smtp-username" class="input" value="${s.username || ''}"></div>
            <div><label class="block text-sm text-gray-400 mb-1">Password (leave blank to keep)</label><input type="password" id="smtp-password" class="input"></div>
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" id="smtp-active" ${s.is_active ? 'checked' : ''} class="rounded bg-surface-900 border-gray-600">
            <label for="smtp-active" class="text-sm">Active</label>
          </div>
          <button type="submit" class="btn btn-primary w-full justify-center"><i class="fas fa-save"></i> Update Server</button>
        </form>
      `);
      document.getElementById('smtp-form').addEventListener('submit', (e) => { e.preventDefault(); SmtpManager.save(id); });
    });
  },

  async test(id) {
    try {
      const res = await fetch(`/api/smtp/${id}/test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();
      App.showToast(data.success ? 'Connection successful!' : `Failed: ${data.message}`, data.success ? 'success' : 'error');
    } catch(e) { App.showToast('Test failed', 'error'); }
  },

  async deleteServer(id) {
    if (!confirm('Delete this SMTP server?')) return;
    try {
      await fetch(`/api/smtp/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      App.showToast('SMTP server deleted', 'success');
      SmtpManager.load();
    } catch(e) { App.showToast(e.message, 'error'); }
  }
};