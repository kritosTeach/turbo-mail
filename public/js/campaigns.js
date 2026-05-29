const CampaignManager = {
  async render() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Campaigns</h2>
            <p class="text-gray-500 text-sm">Manage and monitor your email campaigns</p>
          </div>
          <button onclick="App.navigateTo('compose')" class="btn btn-primary">
            <i class="fas fa-plus"></i> New Campaign
          </button>
        </div>

        <div class="flex gap-2 mb-4">
          <button onclick="CampaignManager.filter('')" class="btn btn-sm btn-secondary">All</button>
          <button onclick="CampaignManager.filter('sending')" class="btn btn-sm btn-secondary">Sending</button>
          <button onclick="CampaignManager.filter('completed')" class="btn btn-sm btn-secondary">Completed</button>
          <button onclick="CampaignManager.filter('draft')" class="btn btn-sm btn-secondary">Drafts</button>
          <button onclick="CampaignManager.filter('failed')" class="btn btn-sm btn-secondary">Failed</button>
        </div>

        <div class="card">
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Name</th><th>Subject</th><th>Status</th><th>Progress</th><th>Rate</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody id="campaign-table-body"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    await this.load();
  },

  async load(status = '') {
    try {
      const url = status ? `/api/campaigns?status=${status}` : '/api/campaigns';
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();
      const tbody = document.getElementById('campaign-table-body');
      tbody.innerHTML = (data.campaigns || []).map(c => {
        const total = c.total_recipients || 1;
        const pct = Math.round((c.sent_count / total) * 100);
        return `
          <tr>
            <td class="font-medium">${c.name}</td>
            <td class="text-sm text-gray-400 truncate max-w-xs">${c.subject || '-'}</td>
            <td><span class="badge badge-${c.status === 'completed' ? 'success' : c.status === 'sending' ? 'info' : c.status === 'failed' ? 'danger' : c.status === 'draft' ? 'neutral' : 'warning'}">${c.status}</span></td>
            <td>
              <div class="flex items-center gap-2">
                <div class="progress-bar flex-1"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
                <span class="text-xs text-gray-400">${c.sent_count}/${total}</span>
              </div>
            </td>
            <td><span class="text-sm">${c.throttle_rate || '-'}/min</span></td>
            <td class="text-sm text-gray-400">${new Date(c.created_at).toLocaleDateString()}</td>
            <td>
              <div class="flex gap-1">
                ${c.status === 'draft' || c.status === 'paused' ? `<button onclick="CampaignManager.start('${c.id}')" class="btn btn-sm btn-success" title="Start"><i class="fas fa-play"></i></button>` : ''}
                ${c.status === 'sending' ? `<button onclick="CampaignManager.pause('${c.id}')" class="btn btn-sm btn-warning" title="Pause"><i class="fas fa-pause"></i></button>` : ''}
                ${c.status === 'paused' ? `<button onclick="CampaignManager.resume('${c.id}')" class="btn btn-sm btn-success" title="Resume"><i class="fas fa-play"></i></button>` : ''}
                ${c.status === 'sending' || c.status === 'paused' ? `<button onclick="CampaignManager.cancel('${c.id}')" class="btn btn-sm btn-danger" title="Cancel"><i class="fas fa-stop"></i></button>` : ''}
                <button onclick="CampaignManager.viewDetails('${c.id}')" class="btn btn-sm btn-secondary" title="Details"><i class="fas fa-eye"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join('') || '<tr><td colspan="7" class="text-center py-8 text-gray-500">No campaigns yet. Create your first one!</td></tr>';

    } catch(e) { App.showToast('Failed to load campaigns', 'error'); }
  },

  filter(status) { this.load(status); },

  async start(id) {
    try {
      const res = await fetch(`/api/campaigns/${id}/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();
      if (res.ok) { App.showToast(data.message || 'Campaign started', 'success'); this.load(); }
      else throw new Error(data.error);
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async pause(id) {
    try {
      await fetch(`/api/campaigns/${id}/pause`, { method: 'POST', headers: { 'Authorization': `Bearer ${App.state.token}` } });
      App.showToast('Campaign paused', 'info'); this.load();
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async resume(id) {
    try {
      await fetch(`/api/campaigns/${id}/resume`, { method: 'POST', headers: { 'Authorization': `Bearer ${App.state.token}` } });
      App.showToast('Campaign resumed', 'success'); this.load();
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async cancel(id) {
    if (!confirm('Cancel this campaign?')) return;
    try {
      await fetch(`/api/campaigns/${id}/cancel`, { method: 'POST', headers: { 'Authorization': `Bearer ${App.state.token}` } });
      App.showToast('Campaign cancelled', 'info'); this.load();
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async viewDetails(id) {
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();
      const c = data.campaign;

      App.showModal(`
        <div class="space-y-4 max-h-[80vh] overflow-y-auto">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">${c.name}</h3>
            <span class="badge badge-${c.status === 'completed' ? 'success' : c.status === 'sending' ? 'info' : 'neutral'}">${c.status}</span>
          </div>

          <div class="grid grid-cols-4 gap-3">
            <div class="bg-surface-900 p-3 rounded-lg text-center">
              <div class="text-2xl font-bold text-blue-400">${c.sent_count || 0}</div>
              <div class="text-xs text-gray-500">Sent</div>
            </div>
            <div class="bg-surface-900 p-3 rounded-lg text-center">
              <div class="text-2xl font-bold text-green-400">${c.open_count || 0}</div>
              <div class="text-xs text-gray-500">Opened</div>
            </div>
            <div class="bg-surface-900 p-3 rounded-lg text-center">
              <div class="text-2xl font-bold text-yellow-400">${c.click_count || 0}</div>
              <div class="text-xs text-gray-500">Clicked</div>
            </div>
            <div class="bg-surface-900 p-3 rounded-lg text-center">
              <div class="text-2xl font-bold text-red-400">${c.failed_count || 0}</div>
              <div class="text-xs text-gray-500">Failed</div>
            </div>
          </div>

          <div class="text-sm space-y-1 text-gray-400">
            <p><span class="text-gray-300">From:</span> ${c.from_name} &lt;${c.from_email}&gt;</p>
            <p><span class="text-gray-300">Subject:</span> ${c.subject}</p>
            <p><span class="text-gray-300">Reply-To:</span> ${c.reply_to || '-'}</p>
            <p><span class="text-gray-300">Tracking:</span> ${c.tracking_enabled ? '<span class="text-green-400">Enabled</span>' : '<span class="text-gray-500">Disabled</span>'}</p>
            <p><span class="text-gray-300">Throttle:</span> ${c.throttle_rate}/min</p>
            <p><span class="text-gray-300">Created:</span> ${new Date(c.created_at).toLocaleString()}</p>
            <p><span class="text-gray-300">Recipients:</span> ${c.total_recipients || 0}</p>
          </div>

          <div>
            <h4 class="font-semibold mb-2">Console Output</h4>
            <div class="console-output" id="campaign-console-${c.id}">
              <div class="info">[System] Campaign created: ${new Date(c.created_at).toLocaleString()}</div>
              ${c.status === 'sending' ? '<div class="info">[System] Sending in progress...</div>' : ''}
              ${c.status === 'completed' ? '<div class="info">[System] Campaign completed</div>' : ''}
            </div>
          </div>
        </div>
      `);
    } catch(e) { App.showToast(e.message, 'error'); }
  }
};