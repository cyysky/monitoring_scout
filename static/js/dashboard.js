/**
 * Monitoring Scout - Dashboard JavaScript
 */

// Global state
let hosts = [];
let currentFilter = 'all';
let socket = null;

// DOM Elements
const hostsGrid = document.getElementById('hosts-grid');
const onlineCountEl = document.getElementById('online-count');
const offlineCountEl = document.getElementById('offline-count');
const totalHostsEl = document.getElementById('total-hosts');
const onlineHostsEl = document.getElementById('online-hosts');
const alertHostsEl = document.getElementById('alert-hosts');
const avgCpuEl = document.getElementById('avg-cpu');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    loadHosts();
    updateTime();
    setInterval(updateTime, 1000);
    
    // Setup form handlers
    setupAddHostForm();
    setupEditHostForm();
});

// Socket.IO Connection
function initSocket() {
    socket = io('/monitor');
    
    socket.on('connect', () => {
        console.log('Connected to monitoring socket');
    });
    
    socket.on('host_update', (data) => {
        console.log('Host update received:', data);
        updateHostInGrid(data.host_id, data.metrics, data.last_check);
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from monitoring socket');
    });
}

// Update time display
function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: true 
    });
    const dateStr = now.toLocaleDateString('en-US', { 
        weekday: 'short',
        month: 'short', 
        day: 'numeric' 
    });
    
    const timeEl = document.getElementById('current-time');
    if (timeEl) {
        timeEl.textContent = `${dateStr}, ${timeStr}`;
    }
}

// Load hosts from API
async function loadHosts() {
    try {
        const response = await fetch('/api/hosts');
        const data = await response.json();
        
        if (data.hosts) {
            hosts = data.hosts;
            console.log('Loaded hosts:', hosts.length);
            renderHosts();
            updateStats();
        }
    } catch (error) {
        console.error('Error loading hosts:', error);
        showError('Failed to load hosts');
    }
}

// Update stats display
function updateStats() {
    const total = hosts.length;
    const online = hosts.filter(h => h.metrics?.status === 'online').length;
    const offline = hosts.filter(h => h.metrics?.status === 'offline').length;
    const checking = hosts.filter(h => h.metrics?.status === 'checking' || h.metrics?.status === 'unknown').length;
    
    const alerts = hosts.filter(h => {
        const m = h.metrics;
        return m?.status === 'online' && (
            (m.cpu_percent > 80) || 
            (m.memory_percent > 90) || 
            (m.disk_percent > 90)
        );
    }).length;
    
    // Calculate average CPU for online hosts
    const onlineHosts = hosts.filter(h => h.metrics?.status === 'online');
    const avgCpu = onlineHosts.length > 0 
        ? Math.round(onlineHosts.reduce((acc, h) => acc + (h.metrics?.cpu_percent || 0), 0) / onlineHosts.length)
        : 0;
    
    if (totalHostsEl) totalHostsEl.textContent = total;
    if (onlineHostsEl) onlineHostsEl.textContent = online;
    if (alertHostsEl) alertHostsEl.textContent = alerts;
    if (avgCpuEl) avgCpuEl.textContent = avgCpu + '%';
    if (onlineCountEl) onlineCountEl.textContent = online;
    if (offlineCountEl) offlineCountEl.textContent = offline + checking;
}

// Get color class based on percentage
function getProgressClass(percent) {
    if (percent < 50) return 'low';
    if (percent < 80) return 'medium';
    return 'high';
}

// Render hosts grid
function renderHosts() {
    if (!hostsGrid) return;
    
    const filteredHosts = currentFilter === 'all' 
        ? hosts 
        : hosts.filter(h => h.metrics?.status === currentFilter);
    
    if (filteredHosts.length === 0) {
        hostsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 60px 20px;">
                <i class="fas fa-server" style="font-size: 48px; color: var(--text-muted); margin-bottom: 20px;"></i>
                <h3 style="color: var(--text-secondary); margin-bottom: 10px;">No hosts found</h3>
                <p style="color: var(--text-muted);">${currentFilter === 'all' ? 'Add your first host to get started' : `No ${currentFilter} hosts`}</p>
                ${currentFilter === 'all' ? '<button class="btn btn-primary" onclick="showAddHostModal()" style="margin-top: 20px;"><i class="fas fa-plus"></i> Add Host</button>' : ''}
            </div>
        `;
        return;
    }
    
    hostsGrid.innerHTML = filteredHosts.map(host => createHostCard(host)).join('');
}

// Create host card HTML
function createHostCard(host) {
    const metrics = host.metrics || {};
    const status = metrics.status || 'unknown';
    const isOnline = status === 'online';
    const isChecking = status === 'checking' || status === 'unknown';
    
    const cpuPercent = metrics.cpu_percent || 0;
    const memPercent = metrics.memory_percent || 0;
    const diskPercent = metrics.disk_percent || 0;
    
    // Status colors
    let statusColor = 'var(--danger-light)';
    let statusBg = 'linear-gradient(135deg, rgba(218, 54, 51, 0.2), rgba(244, 81, 73, 0.1))';
    if (isOnline) {
        statusColor = 'var(--success-light)';
        statusBg = 'linear-gradient(135deg, rgba(35, 134, 54, 0.15), rgba(63, 185, 80, 0.05))';
    } else if (isChecking) {
        statusColor = 'var(--warning-color)';
        statusBg = 'linear-gradient(135deg, rgba(240, 136, 62, 0.15), rgba(247, 183, 51, 0.05))';
    }
    
    return `
        <div class="host-card ${status}" data-host-id="${host.id}">
            <div class="host-header" style="background: ${statusBg};">
                <div class="host-info">
                    <h4>${escapeHtml(host.name)}</h4>
                    <span class="host-ip">${host.ip}:${host.port || 22}</span>
                </div>
                <span class="host-status ${status}" style="color: ${statusColor};">
                    ${isChecking ? '<i class="fas fa-circle-notch fa-spin"></i>' : '<i class="fas fa-circle"></i>'}
                    ${isOnline ? 'Online' : (isChecking ? 'Checking...' : 'Offline')}
                </span>
            </div>
            <div class="host-body">
                <div class="metric-row">
                    <div class="metric">
                        <div class="metric-label">CPU Usage</div>
                        <div class="metric-value">${isOnline ? cpuPercent.toFixed(1) + '%' : (isChecking ? '...' : 'N/A')}</div>
                        ${isOnline ? `
                        <div class="progress-bar">
                            <div class="progress-fill ${getProgressClass(cpuPercent)}" style="width: ${Math.min(cpuPercent, 100)}%"></div>
                        </div>
                        ` : '<div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>'}
                    </div>
                </div>
                <div class="metric-row">
                    <div class="metric" style="flex: 1;">
                        <div class="metric-label">Memory</div>
                        <div class="metric-value">${isOnline ? memPercent.toFixed(1) + '%' : (isChecking ? '...' : 'N/A')}</div>
                        ${isOnline ? `
                        <div class="progress-bar">
                            <div class="progress-fill ${getProgressClass(memPercent)}" style="width: ${Math.min(memPercent, 100)}%"></div>
                        </div>
                        ` : '<div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>'}
                    </div>
                    <div class="metric" style="flex: 1; margin-left: 20px;">
                        <div class="metric-label">Disk</div>
                        <div class="metric-value">${isOnline ? diskPercent + '%' : (isChecking ? '...' : 'N/A')}</div>
                        ${isOnline ? `
                        <div class="progress-bar">
                            <div class="progress-fill ${getProgressClass(diskPercent)}" style="width: ${Math.min(diskPercent, 100)}%"></div>
                        </div>
                        ` : '<div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>'}
                    </div>
                </div>
            </div>
            <div class="host-footer">
                <span class="host-group">${escapeHtml(host.group || 'Default')}</span>
                <div class="host-actions">
                    ${isOnline ? `
                        <button class="btn-icon" onclick="openTerminal('${host.id}')" title="Open Terminal">
                            <i class="fas fa-terminal"></i>
                        </button>
                    ` : ''}
                    <button class="btn-icon" onclick="viewHostDetails('${host.id}')" title="View Details">
                        <i class="fas fa-info-circle"></i>
                    </button>
                    <button class="btn-icon" onclick="editHost('${host.id}')" title="Edit Host">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon btn-danger" onclick="deleteHost('${host.id}')" title="Delete Host">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// Update single host in grid
function updateHostInGrid(hostId, metrics, lastCheck) {
    console.log('Updating host in grid:', hostId, metrics);
    
    const hostIndex = hosts.findIndex(h => h.id === hostId);
    if (hostIndex === -1) {
        console.log('Host not found in list, reloading...');
        // Host might be newly added, reload all
        loadHosts();
        return;
    }
    
    hosts[hostIndex].metrics = metrics;
    hosts[hostIndex].last_check = lastCheck;
    
    // Update stats
    updateStats();
    
    // Only re-render if filter allows this host
    if (currentFilter === 'all' || metrics.status === currentFilter) {
        const card = document.querySelector(`[data-host-id="${hostId}"]`);
        if (card) {
            // Update the card in place for smoother experience
            const newCard = createHostCard(hosts[hostIndex]);
            card.outerHTML = newCard;
        } else if (currentFilter === 'all') {
            // Card doesn't exist, re-render all
            renderHosts();
        }
    }
}

// Filter hosts
function filterHosts(filter) {
    currentFilter = filter;
    renderHosts();
}

// Show add host modal
function showAddHostModal() {
    const modal = document.getElementById('addHostModal');
    if (modal) {
        modal.classList.add('show');
        document.getElementById('addHostForm').reset();
    }
}

// Show edit host modal
async function editHost(hostId) {
    const host = hosts.find(h => h.id === hostId);
    if (!host) return;
    
    const modal = document.getElementById('editHostModal');
    const form = document.getElementById('editHostForm');
    
    form.elements['host_id'].value = host.id;
    form.elements['name'].value = host.name;
    form.elements['ip'].value = host.ip;
    form.elements['port'].value = host.port || 22;
    form.elements['username'].value = host.username || '';
    form.elements['group'].value = host.group || '';
    form.elements['description'].value = host.description || '';
    form.elements['password'].value = '';
    
    modal.classList.add('show');
}

// Setup add host form
function setupAddHostForm() {
    const form = document.getElementById('addHostForm');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        data.port = parseInt(data.port) || 22;
        
        // Show loading state
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Adding...';
        submitBtn.disabled = true;
        
        try {
            console.log('Adding host:', data);
            const response = await fetch('/api/hosts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            console.log('Add host result:', result);
            
            if (result.success) {
                closeModal('addHostModal');
                showSuccess('Host added successfully');
                
                // Add the new host to the local array
                hosts.push(result.host);
                renderHosts();
                updateStats();
                
                // The server will send a WebSocket update when the check is complete
            } else {
                showError(result.error || 'Failed to add host');
            }
        } catch (error) {
            console.error('Error adding host:', error);
            showError('Failed to add host: ' + error.message);
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Setup edit host form
function setupEditHostForm() {
    const form = document.getElementById('editHostForm');
    if (!form) return;
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        const hostId = data.host_id;
        delete data.host_id;
        data.port = parseInt(data.port) || 22;
        
        // Don't send empty password
        if (!data.password) {
            delete data.password;
        }
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
        submitBtn.disabled = true;
        
        try {
            const response = await fetch(`/api/hosts/${hostId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                closeModal('editHostModal');
                showSuccess('Host updated successfully');
                
                // Update local data
                const index = hosts.findIndex(h => h.id === hostId);
                if (index !== -1) {
                    hosts[index] = result.host;
                    renderHosts();
                    updateStats();
                }
            } else {
                showError(result.error || 'Failed to update host');
            }
        } catch (error) {
            console.error('Error updating host:', error);
            showError('Failed to update host');
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    });
}

// Delete host
async function deleteHost(hostId) {
    if (!confirm('Are you sure you want to delete this host?')) return;
    
    try {
        const response = await fetch(`/api/hosts/${hostId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Host deleted successfully');
            hosts = hosts.filter(h => h.id !== hostId);
            renderHosts();
            updateStats();
        } else {
            showError(result.error || 'Failed to delete host');
        }
    } catch (error) {
        console.error('Error deleting host:', error);
        showError('Failed to delete host');
    }
}

// View host details
async function viewHostDetails(hostId) {
    const host = hosts.find(h => h.id === hostId);
    if (!host) return;
    
    const metrics = host.metrics || {};
    const modal = document.getElementById('hostDetailsModal');
    const content = document.getElementById('hostDetailsContent');
    const terminalBtn = document.getElementById('terminalBtn');
    
    terminalBtn.href = `/terminal/${hostId}`;
    terminalBtn.target = `_blank_${hostId}`;
    
    // Show loading state
    content.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-circle-notch fa-spin" style="font-size: 32px; color: var(--primary-color);"></i><p style="margin-top: 15px; color: var(--text-muted);">Loading metrics...</p></div>';
    modal.classList.add('show');
    
    // Fetch latest metrics
    let latestMetrics = metrics;
    try {
        const response = await fetch(`/api/hosts/${hostId}/metrics`);
        const data = await response.json();
        if (data.metrics) {
            latestMetrics = data.metrics;
            // Update local data
            host.metrics = latestMetrics;
            renderHosts();
        }
    } catch (e) {
        console.error('Error fetching metrics:', e);
    }
    
    const statusColor = latestMetrics.status === 'online' ? 'var(--success-light)' : 
                       (latestMetrics.status === 'checking' ? 'var(--warning-color)' : 'var(--danger-light)');
    
    content.innerHTML = `
        <div class="detail-grid">
            <div class="detail-item">
                <div class="detail-label">Host Name</div>
                <div class="detail-value">${escapeHtml(host.name)}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Status</div>
                <div class="detail-value" style="color: ${statusColor};">
                    <i class="fas fa-circle" style="font-size: 8px; margin-right: 5px;"></i>
                    ${latestMetrics.status === 'online' ? 'Online' : (latestMetrics.status === 'checking' ? 'Checking...' : 'Offline')}
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-label">IP Address</div>
                <div class="detail-value">${host.ip}:${host.port || 22}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Username</div>
                <div class="detail-value">${escapeHtml(host.username || 'N/A')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Group</div>
                <div class="detail-value">${escapeHtml(host.group || 'Default')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Uptime</div>
                <div class="detail-value">${latestMetrics.uptime || 'N/A'}</div>
            </div>
            <div class="detail-item full-width">
                <div class="detail-label">Description</div>
                <div class="detail-value" style="font-family: inherit; font-weight: normal;">${escapeHtml(host.description || 'No description')}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">CPU Usage</div>
                <div class="detail-value">${(latestMetrics.cpu_percent || 0).toFixed(1)}%</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Memory Usage</div>
                <div class="detail-value">${(latestMetrics.memory_percent || 0).toFixed(1)}% (${latestMetrics.memory_used || 'N/A'} / ${latestMetrics.memory_total || 'N/A'})</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Disk Usage</div>
                <div class="detail-value">${latestMetrics.disk_percent || 0}% (${latestMetrics.disk_used || 'N/A'} / ${latestMetrics.disk_total || 'N/A'})</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Load Average</div>
                <div class="detail-value">${(latestMetrics.load_avg || [0,0,0]).join(', ')}</div>
            </div>
            ${latestMetrics.error ? `
            <div class="detail-item full-width">
                <div class="detail-label">Error</div>
                <div class="detail-value" style="color: var(--danger-light); font-family: inherit; font-weight: normal;">${escapeHtml(latestMetrics.error)}</div>
            </div>
            ` : ''}
        </div>
    `;
}

// Open terminal in new window
function openTerminal(hostId) {
    const width = 900;
    const height = 600;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    window.open(
        `/terminal/${hostId}`,
        `terminal_${hostId}`,
        `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=no,resizable=yes`
    );
}

// Close modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

// Refresh all hosts
async function refreshAllHosts() {
    const btn = document.querySelector('[onclick="refreshAllHosts()"]');
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.classList.add('fa-spin');
    }
    
    await loadHosts();
    
    if (btn) {
        setTimeout(() => {
            const icon = btn.querySelector('i');
            if (icon) icon.classList.remove('fa-spin');
        }, 500);
    }
}

// Utility: Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Utility: Show success message
function showSuccess(message) {
    // Create a toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--success-color);
        color: white;
        padding: 12px 20px;
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-lg);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;
    toast.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Utility: Show error message
function showError(message) {
    // Create a toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--danger-color);
        color: white;
        padding: 12px 20px;
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-lg);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;
    toast.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Add toast animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
    }
}
