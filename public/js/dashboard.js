const Dashboard = {
  async render() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Dashboard</h2>
            <p class="text-gray-500 text-sm">Campaign performance overview</p>
          </div>
          <div class="flex gap-2">
            <span class="flex items-center gap-1 text-sm text-gray-400"><span class="w-2 h-2 bg-green-400 rounded-full pulse-dot"></span> Live</span>
            <button onclick="Dashboard.load()" class="btn btn-sm btn-secondary"><i class="fas fa-sync"></i> Refresh</button>
          </div>
        </div>

        <!-- Stats Cards -->
        <div id="stats-cards" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div class="stat-card"><div class="stat-icon bg-blue-900/30 text-blue-400"><i class="fas fa-paper-plane"></i></div><div class="stat-value" id="stat-sent">-</div><div class="stat-label">Sent</div></div>
          <div class="stat-card"><div class="stat-icon bg-green-900/30 text-green-400"><i class="fas fa-check-circle"></i></div><div class="stat-value" id="stat-delivered">-</div><div class="stat-label">Delivered</div></div>
          <div class="stat-card"><div class="stat-icon bg-red-900/30 text-red-400"><i class="fas fa-exclamation-circle"></i></div><div class="stat-value" id="stat-failed">-</div><div class="stat-label">Failed</div></div>
          <div class="stat-card"><div class="stat-icon bg-purple-900/30 text-purple-400"><i class="fas fa-eye"></i></div><div class="stat-value" id="stat-opens">-</div><div class="stat-label">Opens</div></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div class="card p-5">
            <h3 class="font-semibold mb-4">Delivery Rate (Last 7 Days)</h3>
            <canvas id="delivery-chart" height="200"></canvas>
          </div>
          <div class="card p-5">
            <h3 class="font-semibold mb-4">Today's Activity</h3>
            <canvas id="today-chart" height="200"></canvas>
          </div>
        </div>

        <div class="card p-5 mb-6">
          <h3 class="font-semibold mb-4">Recent Campaigns</h3>
          <div id="recent-campaigns" class="space-y-2"></div>
        </div>

        <div class="card p-5">
          <h3 class="font-semibold mb-4">SMTP Server Health</h3>
          <div id="smtp-health" class="space-y-2"></div>
        </div>
      </div>
    `;

    this.load();
  },

  async load() {
    try {
      const res = await fetch('/api/dashboard/stats', {
        headers: { 'Authorization': `Bearer ${App.state.token}` }
      });
      const data = await res.json();

      document.getElementById('stat-sent').textContent = data.stats?.total_sent || 0;
      document.getElementById('stat-delivered').textContent = (data.stats?.total_sent || 0) - (data.stats?.total_failed || 0);
      document.getElementById('stat-failed').textContent = data.stats?.total_failed || 0;
      document.getElementById('stat-opens').textContent = data.stats?.total_opens || 0;

      // Delivery chart
      this.renderDeliveryChart(data.deliveryRateOverTime);
      this.renderTodayChart(data.today_distinction);
      this.renderRecentCampaigns(data.recentCampaigns);
      this.renderSmtpHealth(data.smtpServers);

    } catch(e) { App.showToast('Failed to load dashboard', 'error'); }
  },

  renderDeliveryChart(deliveryData) {
    const ctx = document.getElementById('delivery-chart');
    if (!ctx) return;
    if (this._deliveryChart) this._deliveryChart.destroy();

    const labels = (deliveryData || []).map(d => new Date(d.date).toLocaleDateString());
    const sent = (deliveryData || []).map(d => parseInt(d.sent) || 0);
    const failed = (deliveryData || []).map(d => parseInt(d.failed) || 0);

    this._deliveryChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Sent', data: sent, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, fill: true },
          { label: 'Failed', data: failed, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', tension: 0.3, fill: true }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, beginAtZero: true }
        }
      }
    });
  },

  renderTodayChart(today) {
    const ctx = document.getElementById('today-chart');
    if (!ctx) return;

    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Sent', 'Failed', 'Bounced'],
        datasets: [{
          data: [today?.today_sent || 0, today?.today_failed || 0, today?.today_bounced || 0],
          backgroundColor: ['#3b82f6', '#ef4444', '#f59e0b']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } }
      }
    });
  },

  renderRecentCampaigns(campaigns) {
    const container = document.getElementById('recent-campaigns');
    if (!container) return;
    container.innerHTML = (campaigns || []).map(c => `
      <div class="flex items-center justify-between p-3 bg-surface-900 rounded-lg">
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate">${c.name}</p>
          <p class="text-xs text-gray-500">${c.total_recipients || 0} recipients &middot; ${new Date(c.created_at).toLocaleString()}</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-400">${c.sent_count || 0}/${c.total_recipients || 0}</span>
          <span class="badge badge-${c.status === 'completed' ? 'success' : c.status === 'sending' ? 'info' : c.status === 'failed' ? 'danger' : 'neutral'}">${c.status}</span>
        </div>
      </div>
    `).join('');
  },

  renderSmtpHealth(servers) {
    const container = document.getElementById('smtp-health');
    if (!container) return;
    container.innerHTML = (servers || []).map(s => `
      <div class="flex items-center justify-between p-3 bg-surface-900 rounded-lg">
        <div class="flex items-center gap-3">
          <span class="w-2 h-2 rounded-full ${s.is_active ? 'bg-green-400' : 'bg-red-400'}"></span>
          <span class="font-medium">${s.name}</span>
          <span class="text-xs text-gray-500">${s.host}:${s.port}</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-gray-400">${s.fail_count || 0} failures</span>
          <span class="text-xs text-gray-500">${s.last_used_at ? new Date(s.last_used_at).toLocaleTimeString() : 'Never'}</span>
        </div>
      </div>
    `).join('');
  }
};