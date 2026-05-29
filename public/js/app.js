// TurboMailer Pro - Main Application Controller

const App = {
  state: {
    currentPage: 'dashboard',
    user: null,
    token: null,
    socket: null,
    charts: {},
    wsUrl: `ws://${window.location.hostname}:3001`
  },

  init() {
    this.checkAuth();
    this.setupNavigation();
    this.setupLogout();
    this.setupMobileMenu();
  },

  checkAuth() {
    const token = localStorage.getItem('turbomailer_token');
    const user = localStorage.getItem('turbomailer_user');

    if (!token) {
      this.showLogin();
      return;
    }

    this.state.token = token;
    this.state.user = user ? JSON.parse(user) : null;
    this.connectWebSocket();
    this.navigateTo(this.getPageFromUrl() || 'dashboard');
  },

  showLogin() {
    document.getElementById('page-content').innerHTML = `
      <div class="min-h-screen flex items-center justify-center -m-4 md:-m-6">
        <div class="w-full max-w-md p-8">
          <div class="text-center mb-8">
            <div class="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-bolt text-white text-2xl"></i>
            </div>
            <h2 class="text-2xl font-bold">TurboMailer Pro</h2>
            <p class="text-gray-500 mt-1">Enterprise Email Broadcasting</p>
          </div>
          <div class="card p-6">
            <h3 class="text-lg font-semibold mb-4">Sign In</h3>
            <form id="login-form" class="space-y-4">
              <div>
                <label class="block text-sm text-gray-400 mb-1">Username</label>
                <input type="text" id="login-username" class="input" placeholder="Enter username" required>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Password</label>
                <input type="password" id="login-password" class="input" placeholder="Enter password" required>
              </div>
              <button type="submit" class="btn btn-primary btn-lg w-full justify-center">
                <i class="fas fa-sign-in-alt"></i> Sign In
              </button>
            </form>
            <div id="login-error" class="text-red-400 text-sm mt-2 hidden"></div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error');
      const btn = e.target.querySelector('button');

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
      errorEl.classList.add('hidden');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Login failed');
        }

        if (data.requires2FA) {
          this.show2FA(data.user.id);
          return;
        }

        localStorage.setItem('turbomailer_token', data.token);
        localStorage.setItem('turbomailer_user', JSON.stringify(data.user));
        this.state.user = data.user;
        this.state.token = data.token;
        this.connectWebSocket();
        this.navigateTo('dashboard');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
      }
    });
  },

  // TurboMailer Pro - Main Application Controller (continued)

  // ...continued from show2FA method
  show2FA(userId) {
    document.getElementById('page-content').innerHTML = `
      <div class="min-h-screen flex items-center justify-center -m-4 md:-m-6">
        <div class="w-full max-w-md p-8">
          <div class="card p-6">
            <h3 class="text-lg font-semibold mb-4">Two-Factor Authentication</h3>
            <p class="text-gray-400 text-sm mb-4">Enter the 6-digit code from your authenticator app.</p>
            <form id="2fa-form" class="space-y-4">
              <div>
                <input type="text" id="2fa-code" class="input text-center text-2xl tracking-widest" placeholder="000000" maxlength="6" required>
              </div>
              <button type="submit" class="btn btn-primary btn-lg w-full justify-center">
                <i class="fas fa-shield-alt"></i> Verify
              </button>
            </form>
            <div id="2fa-error" class="text-red-400 text-sm mt-2 hidden"></div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('2fa-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('2fa-code').value;
      const errorEl = document.getElementById('2fa-error');
      const btn = e.target.querySelector('button');

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';

      try {
        const res = await fetch('/api/auth/2fa/authenticate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, token: code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid code');

        localStorage.setItem('turbomailer_token', data.token);
        // Fetch user data
        const userRes = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${data.token}` }
        });
        const userData = await userRes.json();
        localStorage.setItem('turbomailer_user', JSON.stringify(userData.user));
        this.state.user = userData.user;
        this.state.token = data.token;
        this.connectWebSocket();
        this.navigateTo('dashboard');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-shield-alt"></i> Verify';
      }
    });
  },

  connectWebSocket() {
    if (this.state.socket) return;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => console.log('WebSocket connected');
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketMessage(data);
        } catch(e) {}
      };
      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 5s...');
        setTimeout(() => { this.state.socket = null; this.connectWebSocket(); }, 5000);
      };
      this.state.socket = ws;
    } catch(e) {
      console.log('WebSocket not available, using polling fallback');
    }
  },

  handleWebSocketMessage(data) {
    if (data.type === 'email:sent' || data.type === 'email:failed') {
      const event = new CustomEvent('email-event', { detail: data });
      window.dispatchEvent(event);
    }
  },

  setupNavigation() {
    document.querySelectorAll('[data-page]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const page = el.dataset.page;
        this.navigateTo(page);
        this.updateUrl(page);
      });
    });

    window.addEventListener('popstate', () => {
      this.navigateTo(this.getPageFromUrl());
    });
  },

  navigateTo(page) {
    if (!page) page = 'dashboard';
    this.state.currentPage = page;

    // Update active nav
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Render page
    switch(page) {
      case 'dashboard': Dashboard.render(); break;
      case 'smtp': SmtpManager.render(); break;
      case 'compose': this.renderCompose(); break;
      case 'templates': this.renderTemplates(); break;
      case 'recipients': RecipientsManager.render(); break;
      case 'campaigns': CampaignManager.render(); break;
      case 'logs': LogsViewer.render(); break;
      case 'settings': this.renderSettings(); break;
      default: Dashboard.render();
    }
  },

  getPageFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('page');
  },

  updateUrl(page) {
    const url = new URL(window.location);
    url.searchParams.set('page', page);
    window.history.pushState({}, '', url);
  },

  setupLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem('turbomailer_token');
      localStorage.removeItem('turbomailer_user');
      this.state.user = null;
      this.state.token = null;
      if (this.state.socket) { this.state.socket.close(); this.state.socket = null; }
      this.showLogin();
    });
  },

  setupMobileMenu() {
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('hidden');
      sidebar.classList.toggle('flex');
      sidebar.classList.toggle('fixed');
      sidebar.classList.toggle('inset-0');
      sidebar.classList.toggle('z-40');
    });
  },

  // --- COMPOSE PAGE ---
  async renderCompose() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Compose Email</h2>
            <p class="text-gray-500 text-sm">Create and send a new email campaign</p>
          </div>
          <div class="flex gap-2">
            <button onclick="App.saveAsDraft()" class="btn btn-secondary"><i class="fas fa-save"></i> Save Draft</button>
            <button onclick="App.sendCampaign()" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Send</button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2 space-y-4">
            <div class="card p-5 space-y-4">
              <h3 class="font-semibold">Email Details</h3>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm text-gray-400 mb-1">Campaign Name</label>
                  <input type="text" id="campaign-name" class="input" placeholder="My Campaign">
                </div>
                <div>
                  <label class="block text-sm text-gray-400 mb-1">Subject</label>
                  <input type="text" id="email-subject" class="input" placeholder="Enter subject line">
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header flex items-center justify-between">
                <h3 class="font-semibold">HTML Editor</h3>
                <div class="flex gap-2">
                  <button onclick="App.toggleEditorMode()" class="btn btn-sm btn-secondary">
                    <i class="fas fa-code"></i> Source
                  </button>
                  <button onclick="App.insertVariable('{{first_name}}')" class="btn btn-sm btn-secondary">{{first_name}}</button>
                  <button onclick="App.insertVariable('{{last_name}}')" class="btn btn-sm btn-secondary">{{last_name}}</button>
                  <button onclick="App.insertVariable('{{unsubscribe_link}}')" class="btn btn-sm btn-secondary">
                    <i class="fas fa-link"></i>
                  </button>
                </div>
              </div>
              <div class="card-body">
                <div id="editor-container"></div>
                <textarea id="html-source" class="input font-mono text-xs hidden" rows="15" placeholder="HTML source code"></textarea>
              </div>
            </div>

            <div class="card p-5">
              <h3 class="font-semibold mb-3">Mobile Preview</h3>
              <div class="border border-gray-700 rounded-lg overflow-hidden max-w-sm mx-auto">
                <div class="bg-gray-800 px-3 py-1 text-xs text-gray-400 flex items-center gap-2">
                  <i class="fas fa-mobile-alt"></i> Mobile Preview
                </div>
                <iframe id="mobile-preview" class="w-full h-96 bg-white"></iframe>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="card p-5 space-y-4">
              <h3 class="font-semibold flex items-center gap-2">
                <i class="fas fa-shield-exclamation text-yellow-400"></i>
                Hidden Sender Settings
              </h3>
              <div class="bg-yellow-900/20 border border-yellow-800 rounded-lg p-3 text-xs text-yellow-300">
                <i class="fas fa-exclamation-triangle mr-1"></i>
                Warning: Sending emails with spoofed "From" addresses may violate CAN-SPAM, GDPR, and other anti-spam laws. Ensure you have explicit legal authorization.
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">From Name</label>
                <input type="text" id="from-name" class="input" placeholder="Company Name">
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">From Email</label>
                <input type="email" id="from-email" class="input" placeholder="noreply@yourdomain.com">
                <p class="text-xs text-gray-500 mt-1">Can be any address regardless of SMTP auth</p>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Reply-To</label>
                <input type="email" id="reply-to" class="input" placeholder="support@yourdomain.com">
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Return-Path (Envelope From)</label>
                <input type="email" id="return-path" class="input" placeholder="bounce@yourdomain.com">
              </div>
            </div>

            <div class="card p-5 space-y-4">
              <h3 class="font-semibold">Delivery Settings</h3>
              <div>
                <label class="block text-sm text-gray-400 mb-1">SMTP Server</label>
                <select id="smtp-select" class="input">
                  <option value="">Auto-select (round-robin)</option>
                </select>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Throttle (emails/min)</label>
                <input type="number" id="throttle-rate" class="input" value="30" min="1" max="500">
              </div>
              <div class="flex items-center gap-2">
                <input type="checkbox" id="tracking-enabled" checked class="rounded bg-surface-900 border-gray-600">
                <label for="tracking-enabled" class="text-sm text-gray-400">Enable open/click tracking</label>
              </div>
            </div>

            <div class="card p-5 space-y-4">
              <h3 class="font-semibold">Recipients</h3>
              <textarea id="compose-recipients" class="textarea" rows="5" placeholder="email1@example.com, John&#10;email2@example.com, Jane&#10;email3@example.com"></textarea>
              <p class="text-xs text-gray-500">Format: email, FirstName, LastName (one per line)</p>
              <button onclick="App.loadRecipientsFromFile()" class="btn btn-sm btn-secondary w-full">
                <i class="fas fa-upload"></i> Import CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initialize Quill editor
    this.initEditor();

    // Load SMTP servers
    this.loadSmtpServers();
  },

  initEditor() {
    this.quill = new Quill('#editor-container', {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ header: [1,2,3,false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ color: [] }, { background: [] }],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          [{ align: [] }],
          ['link', 'image'],
          ['clean']
        ]
      },
      placeholder: 'Compose your email here...'
    });

    this.quill.on('text-change', () => {
      this.updatePreview();
    });
  },

  toggleEditorMode() {
    const editor = document.getElementById('editor-container');
    const source = document.getElementById('html-source');
    const isSourceHidden = source.classList.contains('hidden');

    editor.classList.toggle('hidden', !isSourceHidden);
    source.classList.toggle('hidden', isSourceHidden);

    if (isSourceHidden) {
      source.value = this.quill ? this.quill.root.innerHTML : '';
    } else {
      if (this.quill) {
        this.quill.root.innerHTML = source.value;
      }
    }
  },

  insertVariable(variable) {
    if (this.quill) {
      const range = this.quill.getSelection(true);
      this.quill.insertText(range.index, variable);
    } else {
      const source = document.getElementById('html-source');
      if (source && !source.classList.contains('hidden')) {
        const start = source.selectionStart;
        source.value = source.value.substring(0, start) + variable + source.value.substring(source.selectionEnd);
      }
    }
  },

  updatePreview() {
    const iframe = document.getElementById('mobile-preview');
    if (iframe && this.quill) {
      const html = this.quill.root.innerHTML;
      iframe.srcdoc = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:sans-serif;padding:16px;color:#333;line-height:1.6;margin:0}
        img{max-width:100%;height:auto}a{color:#2563eb}
        </style></head><body>${html}</body></html>`;
    }
  },

  async loadSmtpServers() {
    try {
      const res = await fetch('/api/smtp', {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const data = await res.json();
      const select = document.getElementById('smtp-select');
      if (data.smtp_servers) {
        data.smtp_servers.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.host}:${s.port})`;
          select.appendChild(opt);
        });
      }
    } catch(e) {}
  },

  async saveAsDraft() {
    const htmlContent = this.quill ? this.quill.root.innerHTML : document.getElementById('html-source').value;
    const payload = {
      name: document.getElementById('campaign-name').value || 'Untitled',
      subject: document.getElementById('email-subject').value,
      from_name: document.getElementById('from-name').value,
      from_email: document.getElementById('from-email').value,
      reply_to: document.getElementById('reply-to').value,
      return_path: document.getElementById('return-path').value,
      html_content: htmlContent,
      smtp_server_id: document.getElementById('smtp-select').value || null,
      throttle_rate: parseInt(document.getElementById('throttle-rate').value) || 30,
      tracking_enabled: document.getElementById('tracking-enabled').checked
    };

    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        App.showToast('Campaign saved as draft', 'success');
      } else {
        throw new Error(data.error);
      }
    } catch(e) {
      App.showToast(e.message, 'error');
    }
  },

  async sendCampaign() {
    const htmlContent = this.quill ? this.quill.root.innerHTML : document.getElementById('html-source').value;
    const recipientsText = document.getElementById('compose-recipients').value;
    const parsed = recipientsText.split('\n').filter(l => l.trim()).map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { email: parts[0], first_name: parts[1] || '', last_name: parts[2] || '' };
    });

    if (parsed.length === 0) {
      App.showToast('Add at least one recipient', 'error');
      return;
    }

    const payload = {
      name: document.getElementById('campaign-name').value || 'Untitled',
      subject: document.getElementById('email-subject').value,
      from_name: document.getElementById('from-name').value,
      from_email: document.getElementById('from-email').value,
      reply_to: document.getElementById('reply-to').value,
      return_path: document.getElementById('return-path').value,
      html_content: htmlContent,
      smtp_server_id: document.getElementById('smtp-select').value || null,
      throttle_rate: parseInt(document.getElementById('throttle-rate').value) || 30,
      tracking_enabled: document.getElementById('tracking-enabled').checked,
      recipients: parsed
    };

    try {
      App.showLoading(true);
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Start the campaign
      const startRes = await fetch(`/api/campaigns/${data.campaign.id}/start`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error);

      App.showToast(`Campaign sent to ${parsed.length} recipients!`, 'success');
      App.navigateTo('campaigns');
    } catch(e) {
      App.showToast(e.message, 'error');
    } finally {
      App.showLoading(false);
    }
  },

  // --- TEMPLATES PAGE ---
  async renderTemplates() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="animate-fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Email Templates</h2>
            <p class="text-gray-500 text-sm">Manage your reusable email templates</p>
          </div>
          <button onclick="App.showTemplateModal()" class="btn btn-primary">
            <i class="fas fa-plus"></i> New Template
          </button>
        </div>
        <div id="templates-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      </div>
    `;
    await this.loadTemplates();
  },

  async loadTemplates() {
    try {
      const res = await fetch('/api/templates', {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const data = await res.json();
      const container = document.getElementById('templates-list');
      container.innerHTML = (data.templates || []).map(t => `
        <div class="card p-5 cursor-pointer hover:border-blue-500/50" onclick="App.openTemplate('${t.id}')">
          <div class="flex items-start justify-between mb-2">
            <h4 class="font-semibold">${t.name}</h4>
            ${t.is_default ? '<span class="badge badge-info text-xs">Default</span>' : ''}
          </div>
          <p class="text-sm text-gray-400 truncate">${t.subject || 'No subject'}</p>
          <div class="flex items-center gap-2 mt-3 text-xs text-gray-500">
            <span>${t.category || 'Uncategorized'}</span>
            <span class="mx-1">&middot;</span>
            <span>${new Date(t.updated_at).toLocaleDateString()}</span>
          </div>
        </div>
      `).join('') || '<p class="text-gray-500 col-span-full text-center py-8">No templates yet. Create your first one!</p>';
    } catch(e) {
      App.showToast('Failed to load templates', 'error');
    }
  },

  showTemplateModal(template) {
    App.showModal(`
      <h3 class="text-lg font-semibold mb-4">${template ? 'Edit Template' : 'New Template'}</h3>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">Name</label>
            <input type="text" id="tpl-name" class="input" value="${template?.name || ''}">
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Subject</label>
            <input type="text" id="tpl-subject" class="input" value="${template?.subject || ''}">
          </div>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Category</label>
          <input type="text" id="tpl-category" class="input" value="${template?.category || ''}" placeholder="e.g., Newsletter, Welcome">
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">HTML Content</label>
          <textarea id="tpl-html" class="textarea font-mono text-xs" rows="10">${template?.html_content || ''}</textarea>
        </div>
        <button onclick="App.saveTemplate('${template?.id || ''}')" class="btn btn-primary w-full justify-center">
          <i class="fas fa-save"></i> Save Template
        </button>
      </div>
    `);
  },

  async saveTemplate(id) {
    const payload = {
      name: document.getElementById('tpl-name').value,
      subject: document.getElementById('tpl-subject').value,
      html_content: document.getElementById('tpl-html').value,
      category: document.getElementById('tpl-category').value
    };

    try {
      const url = id ? `/api/templates/${id}` : '/api/templates';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        App.closeModal();
        App.showToast(id ? 'Template updated' : 'Template created', 'success');
        App.loadTemplates();
      } else throw new Error(data.error);
    } catch(e) {
      App.showToast(e.message, 'error');
    }
  },

  openTemplate(id) {
    fetch(`/api/templates/${id}`, {
      headers: { 'Authorization': `Bearer ${this.state.token}` }
    }).then(r => r.json()).then(data => {
      this.showTemplateModal(data.template);
    });
  },

  // --- SETTINGS PAGE ---
  renderSettings() {
    const user = this.state.user;
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in max-w-3xl mx-auto">
        <h2 class="text-2xl font-bold mb-6">Settings</h2>
        <div class="space-y-6">
          <div class="card p-5 space-y-4">
            <h3 class="font-semibold flex items-center gap-2"><i class="fas fa-user"></i> Profile</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-400 mb-1">Username</label>
                <input type="text" class="input" value="${user?.username || ''}" disabled>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Role</label>
                <input type="text" class="input" value="${user?.role || ''}" disabled>
              </div>
            </div>
          </div>

          <div class="card p-5 space-y-4">
            <h3 class="font-semibold flex items-center gap-2"><i class="fas fa-shield-alt"></i> Two-Factor Authentication</h3>
            <p class="text-sm text-gray-400">Enhance account security with 2FA.</p>
            <button onclick="App.setup2FA()" class="btn btn-secondary">
              <i class="fas fa-qrcode"></i> Setup 2FA
            </button>
          </div>

          <div class="card p-5 space-y-4">
            <h3 class="font-semibold flex items-center gap-2"><i class="fas fa-key"></i> API Key</h3>
            <p class="text-sm text-gray-400">Generate an API key for external integrations.</p>
            <div class="flex gap-2">
              <input type="text" id="api-key-display" class="input font-mono" placeholder="No API key generated" readonly>
              <button onclick="App.generateApiKey()" class="btn btn-primary flex-shrink-0">
                <i class="fas fa-sync"></i> Generate
              </button>
            </div>
          </div>

          ${user?.role === 'admin' ? `
          <div class="card p-5 space-y-4">
            <h3 class="font-semibold flex items-center gap-2"><i class="fas fa-users-cog"></i> User Management</h3>
            <div id="user-list" class="space-y-2"></div>
            <button onclick="App.showUserModal()" class="btn btn-secondary btn-sm">
              <i class="fas fa-plus"></i> Add User
            </button>
          </div>
          ` : ''}

          <div class="card p-5 space-y-4">
            <h3 class="font-semibold flex items-center gap-2 text-red-400"><i class="fas fa-skull-crossbones"></i> Danger Zone</h3>
            <p class="text-sm text-gray-400">These actions cannot be undone.</p>
            <button class="btn btn-danger" onclick="if(confirm('Are you sure?'))App.clearAllData()">
              <i class="fas fa-trash"></i> Clear All Campaigns & Logs
            </button>
          </div>
        </div>
      </div>
    `;

    if (user?.role === 'admin') this.loadUsers();
  },

  async loadUsers() {
    try {
      const res = await fetch('/api/auth/users', {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const data = await res.json();
      const container = document.getElementById('user-list');
      container.innerHTML = data.users.map(u => `
        <div class="flex items-center justify-between p-3 bg-surface-900 rounded-lg">
          <div>
            <span class="font-medium">${u.username}</span>
            <span class="text-sm text-gray-500 ml-2">${u.email}</span>
            <span class="badge badge-info ml-2">${u.role}</span>
            ${u.is_active ? '' : '<span class="badge badge-warning ml-1">Disabled</span>'}
          </div>
          <div class="flex gap-1">
            <button onclick="App.toggleUser('${u.id}', ${!u.is_active})" class="btn btn-sm btn-secondary">
              <i class="fas ${u.is_active ? 'fa-ban' : 'fa-check'}"></i>
            </button>
            <button onclick="App.deleteUser('${u.id}')" class="btn btn-sm btn-danger">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `).join('');
    } catch(e) {}
  },

  showUserModal() {
    App.showModal(`
      <h3 class="text-lg font-semibold mb-4">Add New User</h3>
      <form id="add-user-form" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Username</label>
          <input type="text" id="new-username" class="input" required>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Email</label>
          <input type="email" id="new-email" class="input" required>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Password</label>
          <input type="password" id="new-password" class="input" required>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Role</label>
          <select id="new-role" class="input">
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary w-full justify-center">
          <i class="fas fa-plus"></i> Create User
        </button>
      </form>
    `);

    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        username: document.getElementById('new-username').value,
        email: document.getElementById('new-email').value,
        password: document.getElementById('new-password').value,
        role: document.getElementById('new-role').value
      };
      try {
        const res = await fetch('/api/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          App.closeModal();
          App.showToast('User created', 'success');
          App.loadUsers();
        } else throw new Error(data.error);
      } catch(e) { App.showToast(e.message, 'error'); }
    });
  },

  async setup2FA() {
    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const data = await res.json();
      App.showModal(`
        <h3 class="text-lg font-semibold mb-4">Setup Two-Factor Authentication</h3>
        <div class="space-y-4">
          <div class="flex justify-center">
            <img src="${data.qrCode}" class="w-48 h-48 bg-white p-2 rounded-lg">
          </div>
          <p class="text-sm text-gray-400 text-center">Scan this QR code with your authenticator app</p>
          <p class="text-xs text-gray-500 text-center">Secret: <code class="bg-surface-900 px-2 py-1 rounded">${data.secret}</code></p>
          <input type="text" id="2fa-verify-code" class="input text-center text-xl tracking-widest" placeholder="000000" maxlength="6">
          <button onclick="App.verify2FA()" class="btn btn-primary w-full justify-center">
            <i class="fas fa-check"></i> Verify & Enable
          </button>
        </div>
      `);
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async verify2FA() {
    const code = document.getElementById('2fa-verify-code').value;
    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.state.token}` },
        body: JSON.stringify({ token: code })
      });
      const data = await res.json();
      if (res.ok) {
        App.closeModal();
        App.showToast('2FA enabled successfully', 'success');
      } else throw new Error(data.error);
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  async generateApiKey() {
    try {
      const res = await fetch('/api/auth/api-key', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const data = await res.json();
      document.getElementById('api-key-display').value = data.apiKey;
      App.showToast('API key generated', 'success');
    } catch(e) { App.showToast(e.message, 'error'); }
  },

  // --- UTILITY FUNCTIONS ---
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i>${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  },

  showModal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay animate-fade-in';
    overlay.innerHTML = `<div class="modal-content p-6">${html}</div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  },

  closeModal() {
    document.querySelector('.modal-overlay')?.remove();
  },

  showLoading(show) {
    document.getElementById('loading-overlay').classList.toggle('hidden', !show);
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());