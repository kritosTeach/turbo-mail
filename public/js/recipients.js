const RecipientsManager = {
  importedRecipients: [],

  render() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Recipients</h2>
            <p class="text-gray-500 text-sm">Import, validate, and manage recipients</p>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="card p-5 space-y-4">
            <h3 class="font-semibold"><i class="fas fa-upload mr-2"></i> Import CSV/TXT</h3>
            <form id="import-form" class="space-y-3">
              <div class="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500/50 transition" id="drop-zone">
                <i class="fas fa-cloud-upload-alt text-3xl text-gray-600 mb-2"></i>
                <p class="text-sm text-gray-400">Drop a CSV or TXT file here, or click to browse</p>
                <p class="text-xs text-gray-600 mt-1">CSV format: email, first_name, last_name, custom_field...</p>
              </div>
              <input type="file" id="file-input" accept=".csv,.txt" class="hidden">
              <button type="submit" class="btn btn-primary w-full justify-center">
                <i class="fas fa-upload"></i> Import
              </button>
            </form>
            <div id="import-results" class="hidden"></div>
          </div>

          <div class="card p-5 space-y-4">
            <h3 class="font-semibold"><i class="fas fa-pen mr-2"></i> Manual Entry</h3>
            <textarea id="manual-recipients" class="textarea" rows="8" placeholder="email1@example.com, John, Doe&#10;email2@example.com, Jane, Smith"></textarea>
            <p class="text-xs text-gray-500">Format: email, FirstName, LastName (one per line)</p>
            <div class="flex gap-2">
              <button onclick="RecipientsManager.validateManual()" class="btn btn-secondary flex-1 justify-center">
                <i class="fas fa-check-circle"></i> Validate
              </button>
              <button onclick="RecipientsManager.addManual()" class="btn btn-primary flex-1 justify-center">
                <i class="fas fa-plus"></i> Add
              </button>
            </div>
          </div>
        </div>

        <div class="card mt-6">
          <div class="card-header flex items-center justify-between">
            <h3 class="font-semibold"><i class="fas fa-ban mr-2"></i> Blacklist</h3>
            <button onclick="RecipientsManager.showBlacklistAdd()" class="btn btn-sm btn-secondary">
              <i class="fas fa-plus"></i> Add to Blacklist
            </button>
          </div>
          <div class="card-body">
            <div id="blacklist-list"></div>
          </div>
        </div>

        <div id="imported-preview" class="hidden mt-6">
          <div class="card p-5">
            <div class="flex items-center justify-between mb-4">
              <h3 class="font-semibold">Imported Recipients Preview</h3>
              <span id="recipient-count" class="text-sm text-gray-400"></span>
            </div>
            <div class="table-container max-h-60 overflow-y-auto">
              <table>
                <thead><tr><th>Email</th><th>First Name</th><th>Last Name</th></tr></thead>
                <tbody id="preview-body"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupFileUpload();
    this.loadBlacklist();
  },

  setupFileUpload() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-blue-500'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-blue-500'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); fileInput.files = e.dataTransfer.files; });

    document.getElementById('import-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!fileInput.files.length) { App.showToast('Select a file first', 'error'); return; }
      await this.importFile(fileInput.files[0]);
    });
  },

  async importFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/recipients/import', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${App.state.token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      this.importedRecipients = data.recipients;
      document.getElementById('import-results').innerHTML = `
        <div class="bg-surface-900 rounded-lg p-3 space-y-1 text-sm">
          <p class="text-green-400"><i class="fas fa-check mr-1"></i> ${data.valid} valid</p>
          <p class="text-red-400"><i class="fas fa-times mr-1"></i> ${data.invalid} invalid</p>
          <p class="text-yellow-400"><i class="fas fa-ban mr-1"></i> ${data.blacklisted || 0} blacklisted</p>
          <p class="text-gray-400">Total: ${data.total} recipients</p>
        </div>
      `;
      document.getElementById('import-results').classList.remove('hidden');

      // Show preview
      const preview = document.getElementById('preview-body');
      preview.innerHTML = data.recipients.slice(0, 20).map(r =>
        `<tr><td>${r.email}</td><td>${r.first_name || '-'}</td><td>${r.last_name || '-'}</td></tr>`
      ).join('');
      document.getElementById('recipient-count').textContent = `Showing ${Math.min(20, data.recipients.length)} of ${data.recipients.length}`;
      document.getElementById('imported-preview').classList.remove('hidden');

      App.showToast(`Imported ${data.valid} recipients`, 'success');
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async validateManual() {
    const text = document.getElementById('manual-recipients').value;
    if (!text) { App.showToast('Enter recipients first', 'error'); return; }

    try {
      const emails = text.split('\n').filter(l => l.trim()).map(l => l.split(',')[0].trim());
      const res = await fetch('/api/recipients/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
        body: JSON.stringify({ emails })
      });
      const data = await res.json();
      const valid = data.results.filter(r => r.valid).length;
      const invalid = data.results.filter(r => !r.valid).length;
      App.showToast(`${valid} valid, ${invalid} invalid`, invalid > 0 ? 'error' : 'success');
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async addManual() {
    const text = document.getElementById('manual-recipients').value;
    if (!text) { App.showToast('Enter recipients first', 'error'); return; }

    try {
      const res = await fetch('/api/recipients/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erroralp);

      this.importedRecipients = data.recipients;
      App.showToast(`Added ${data.valid} recipients`, 'success');
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async loadBlacklist() {
    try {
      const res = await fetch('/api/recipients/blacklist', {
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();
      const container = document.getElementById('blacklist-list');
      container.innerHTML = (data.blacklist || []).map(b => `
        <div class="flex items-center justify-between p-2 bg-surface-900 rounded mb-1">
          <div class="flex items-center gap-2">
            <span class="badge badge-${b.type === 'email' ? 'danger' : 'warning'}">${b.type}</span>
            <span class="font-mono text-sm">${b.value}</span>
            ${b.reason ? `<span class="text-xs text-gray-500">- ${b.reason}</span>` : ''}
          </div>
          <button onclick="RecipientsManager.removeBlacklist('${b.id}')" class="btn btn-sm btn-danger"><i class="fas fa-times"></i></button>
        </div>
      `).join('') || '<p class="text-gray-500 text-sm">No blacklist entries</p>';
    } catch(e) {}
  },

  showBlacklistAdd() {
    App.showModal(`
      <h3 class="text-lg font-semibold mb-4">Add to Blacklist</h3>
      <form id="blacklist-form" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Type</label>
          <select id="bl-type" class="input">
            <option value="email">Email Address</option>
            <option value="domain">Domain</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Value</label>
          <input type="text" id="bl-value" class="input" placeholder="spam@example.com or example.com">
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Reason (optional)</label>
          <input type="text" id="bl-reason" class="input" placeholder="Why is this blocked?">
        </div>
        <button type="submit" class="btn btn-danger w-full justify-center"><i class="fas fa-ban"></i> Block</button>
      </form>
    `);

    document.getElementById('blacklist-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch('/api/recipients/blacklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${App.state.token}` },
          body: JSON.stringify({
            value: document.getElementById('bl-value').value,
            type: document.getElementById('bl-type').value,
            reason: document.getElementById('bl-reason').value
          })
        });
        if (res.ok) {
          App.closeModal();
          App.showToast('Added to blacklist', 'success');
          RecipientsManager.loadBlacklist();
        }
      } catch(e) { App.showToast(e.message, 'error'); }
    });
  },

  async removeBlacklist(id) {
    try {
      await fetch(`/api/recipients/blacklist/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      App.showToast('Removed from blacklist', 'success');
      this.loadBlacklist();
    } catch(e) { App.showToast(e.message, 'error'); }
  }
};