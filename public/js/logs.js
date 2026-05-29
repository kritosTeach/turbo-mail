const LogsViewer = {
  currentFilters: {},

  render() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Email Logs</h2>
            <p class="text-gray-500 text-sm">View and export email delivery logs</p>
          </div>
          <div class="flex gap-2">
            <button onclick="LogsViewer.exportCSV()" class="btn btn-sm btn-secondary"><i class="fas fa-file-csv"></i> CSV</button>
            <button onclick="LogsViewer.exportJSON()" class="btn btn-sm btn-secondary"><i class="fas fa-file-code"></i> JSON</button>
            <button onclick="LogsViewer.load()" class="btn btn-sm btn-secondary"><i class="fas fa-sync"></i> Refresh</button>
          </div>
        </div>

        <div class="card p-4 mb-4">
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label class="block text-xs text-gray-400 mb-1">Status</label>
              <select id="log-filter-status" class="input text-sm">
                <option value="">All</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="bounced">Bounced</option>
                <option value="opened">Opened</option>
                <option value="clicked">Clicked</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">From Date</label>
              <input type="date" id="log-filter-date-from" class="input text-sm">
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">To Date</label>
              <input type="date" id="log-filter-date-to" class="input text-sm">
            </div>
            <div>
              <label class="block text-xs text-gray-400 mb-1">Recipient Email</label>
              <input type="text" id="log-filter-email" class="input text-sm" placeholder="Search email...">
            </div>
            <div class="flex items-end">
              <button onclick="LogsViewer.applyFilters()" class="btn btn-primary w-full justify-center">
                <i class="fas fa-search"></i> Filter
              </button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="table-container">
            <table>
              <thead>
                <tr><th>Time</th><th>Recipient</th><th>Subject</th><th>Status</th><th>SMTP Server</th><th>Message ID</th><th>Error</th></tr>
              </thead>
              <tbody id="logs-table-body"></tbody>
            </table>
          </div>
          <div id="logs-pagination" class="flex items-center justify-between p-4 border-t border-gray-800">
            <span id="logs-info" class="text-sm text-gray-500"></span>
            <div class="flex gap-2">
              <button id="logs-prev" class="btn btn-sm btn-secondary" onclick="LogsViewer.prevPage()"><i class="fas fa-chevron-left"></i> Prev</button>
              <button id="logs-next" class="btn btn-sm btn-secondary" onclick="LogsViewer.nextPage()">Next <i class="fas fa-chevron-right"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.page = 1;
    this.load();
  },

  async load() {
    try {
      const params = new URLSearchParams();
      params.set('page', this.page);
      params.set('limit', '50');

      const status = document.getElementById('log-filter-status')?.value;
      const dateFrom = document.getElementById('log-filter-date-from')?.value;
      const dateTo = document.getElementById('log-filter-date-to')?.value;
      const email = document.getElementById('log-filter-email')?.value;

      if (status) params.set('status', status);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (email) params.set('recipient_email', email);

      const res = await fetch(`/api/logs?${params}`, {
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();

      const tbody = document.getElementById('logs-table-body');
      tbody.innerHTML = (data.logs || []).map(l => `
        <tr>
          <td class="text-sm text-gray-400 whitespace-nowrap">${new Date(l.created_at).toLocaleString()}</td>
          <td class="text-sm">${l.recipient_email}</td>
          <td class="text-sm text-gray-400 truncate max-w-xs">${l.subject || '-'}</td>
          <td><span class="badge badge-${l.status === 'sent' ? 'success' : l.status === 'failed' ? 'danger' : l.status === 'opened' ? 'info' : l.status === 'clicked' ? 'warning' : 'neutral'}">${l.status}</span></td>
          <td class="text-sm text-gray-400">${l.smtp_server_name || '-'}</td>
          <td class="text-xs font-mono text-gray-500 truncate max-w-[120px]">${l.message_id || '-'}</td>
          <td class="text-sm text-red-400 max-w-[200px] truncate">${l.error_message || '-'}</td>
        </tr>
      `).join('') || '<tr><td colspan="7" class="text-center py-8 text-gray-500">No logs found</td></tr>';

      // Pagination
      if (data.pagination) {
        document.getElementById('logs-info').textContent = `Page ${data.pagination.page} of ${data.pagination.totalPages} (${data.pagination.total} total)`;
        document.getElementById('logs-prev').disabled = data.pagination.page <= 1;
        document.getElementById('logs-next').disabled = data.pagination.page >= data.pagination.totalPages;
        this.totalPages = data.pagination.totalPages;
      }
    } catch(e) { App.showToast('Failed to load logs', 'error'); }
  },

  applyFilters() { this.page = 1; this.load(); },
  prevPage() { if (this.page > 1) { this.page--; this.load(); } },
  nextPage() { if (this.page < this.totalPages) { this.page++; this.load(); } },

  exportCSV() {
    const params = new URLSearchParams();
    const status = document.getElementById('log-filter-status')?.value;
    const dateFrom = document.getElementById('log-filter-date-from')?.value;
    const dateTo = document.getElementById('log-filter-date-to')?.value;
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    window.open(`/api/logs/export/csv?${params}&token=${App.state.token}`, '_blank');
  },

  exportJSON() {
    const params = new URLSearchParams();
    const status = document.getElementById('log-filter-status')?.value;
    const dateFrom = document.getElementById('log-filter-date-from')?.value;
    const dateTo = document.getElementById('log-filter-date-to')?.value;
    if (status) params.set('status', status);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    window.open(`/api/logs/export/json?${params}&token=${App.state.token}`, '_blank');
  }
};