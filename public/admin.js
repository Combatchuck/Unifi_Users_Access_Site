// Admin Dashboard JavaScript

let charts = {};
let lastAnomalyAlert = {}; // Track last alert times to avoid spam

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        window.location.href = '/logout';
    }
}

// Send email alert for detected anomalies
async function sendAnomalyAlert(alertType, title, message, anomalies = []) {
    const lastAlert = lastAnomalyAlert[alertType] || 0;
    const now = Date.now();
    
    // Only send alerts once per 30 minutes per alert type (avoid spam)
    if (now - lastAlert < 30 * 60 * 1000) {
        console.log(`Skipping ${alertType} alert - sent recently`);
        return;
    }
    
    try {
        const response = await fetch('/admin/send-alert', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alertType, title, message, anomalies })
        });
        
        if (response.ok) {
            lastAnomalyAlert[alertType] = now;
            console.log(`✅ Alert sent: ${title}`);
        } else {
            console.error(`Alert send failed: ${response.statusText}`);
        }
    } catch (error) {
        console.error(`Error sending alert: ${error.message}`);
    }
}

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded fired - initializing dashboard');
    console.log('Chart library loaded:', typeof Chart !== 'undefined');
    
    if (typeof Chart === 'undefined') {
        showError('Chart.js library failed to load - please refresh the page');
        return;
    }
    
    // Setup logout button (do this first, always)
    const logoutBtn = document.getElementById('adminLogoutBtn');
    if (logoutBtn) {
        console.log('Logout button found, attaching event listener');
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('Logout button clicked');
            if (confirm('Are you sure you want to logout?')) {
                console.log('Navigating to /logout');
                window.location.href = '/logout';
            }
        });
    } else {
        console.warn('Logout button (adminLogoutBtn) not found on page');
    }
    
    try {
        // Check authentication first
        console.log('Checking authentication...');
        const authCheck = await fetch('/api/user-preferences', { credentials: 'include' });
        console.log('Auth check response:', authCheck.status);
        
        if (!authCheck.ok) {
            console.error('Not authenticated, redirecting to login');
            window.location.href = '/';
            return;
        }
        
        console.log('User authenticated, loading dashboard');
        await refreshDashboard();
    } catch (error) {
        console.error('Initialization error:', error);
        console.error('Error stack:', error.stack);
        showError('Failed to initialize dashboard: ' + error.message);
    }
    
    // Auto-refresh every 30 seconds
    setInterval(refreshDashboard, 30000);
});

// Dark mode functionality
function updateChartTheme(theme) {
    const textColor = theme === 'dark' ? '#e0e0e0' : '#333';
    const gridColor = theme === 'dark' ? '#3a3a3a' : '#e0f8fa';
    
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.options.scales.x.ticks.color = textColor;
            chart.options.scales.y.ticks.color = textColor;
            chart.options.scales.x.grid.color = gridColor;
            chart.options.scales.y.grid.color = gridColor;
            chart.update();
        }
    });
}

// Main refresh functions
async function refreshDashboard() {
    try {
        console.log('Starting dashboard refresh...');
        
        // Fetch with timeout
        const fetchWithTimeout = (url, options = {}, timeout = 5000) => {
            console.log(`Fetching ${url}...`);
            return Promise.race([
                fetch(url, { credentials: 'include', ...options })
                    .then(resp => {
                        console.log(`${url} response: ${resp.status} ${resp.statusText}`);
                        if (!resp.ok) {
                            console.error(`${url} returned error: ${resp.status}`);
                        }
                        return resp;
                    })
                    .catch(e => {
                        console.error(`${url} fetch error:`, e);
                        throw e;
                    }),
                new Promise((_, reject) =>
                    setTimeout(() => {
                        console.error(`${url} timed out after 5s`);
                        reject(new Error(`${url} request timeout`));
                    }, timeout)
                )
            ]);
        };
        
        console.log('Fetching API data...');
        const [dashboardResp, healthResp, failuresResp, performanceResp, statusResp] = await Promise.all([
            fetchWithTimeout('/admin/dashboard'),
            fetchWithTimeout('/admin/api-health'),
            fetchWithTimeout('/admin/failed-logins'),
            fetchWithTimeout('/admin/performance'),
            fetchWithTimeout('/admin/status')
        ]);
        
        console.log('Responses received:', {
            dashboard: dashboardResp.status,
            health: healthResp.status,
            failures: failuresResp.status,
            performance: performanceResp.status,
            status: statusResp.status
        });
        
        // Check for redirect or auth errors
        if (!dashboardResp.ok || dashboardResp.redirected) {
            console.error('Dashboard request failed or redirected:', dashboardResp.status);
            showError('Authentication failed - please log in again');
            return;
        }
        
        console.log('Parsing JSON...');
        const [dashboard, health, failures, performance, status] = await Promise.all([
            dashboardResp.json(),
            healthResp.json(),
            failuresResp.json(),
            performanceResp.json(),
            statusResp.json()
        ]);
        
        console.log('Data parsed, updating UI...');
        updateMainMetrics(dashboard);
        updateSystemStatus(status);
        updateApiHealth(health);
        updateFailedLogins(failures);
        updatePerformance(performance);
        updateAlerts(dashboard, status);
        
        // Refresh new health metrics sections with individual error handling
        try {
            console.log('Refreshing health metrics...');
            await Promise.all([
                refreshHealthMetrics().catch(e => console.error('Health metrics error:', e)),
                refreshDatabaseHealth().catch(e => console.error('Database health error:', e)),
                refreshSessions().catch(e => console.error('Sessions error:', e)),
                refreshAuditLog().catch(e => console.error('Audit log error:', e)),
                refreshComprehensiveMetrics().catch(e => console.error('Comprehensive metrics error:', e))
            ]);
        } catch (sectionError) {
            console.error('Error refreshing dashboard sections:', sectionError);
        }
        
        console.log('Dashboard refresh complete');
    } catch (error) {
        console.error('Failed to refresh dashboard:', error);
        console.error('Error stack:', error.stack);
        showError('Failed to load dashboard data: ' + error.message);
    }
}

async function refreshApiHealth() {
    try {
        const data = await fetch('/admin/api-health', { credentials: 'include' }).then(r => r.json());
        updateApiHealth(data);
    } catch (error) {
        console.error('Failed to refresh API health:', error);
    }
}

async function refreshFailedLogins() {
    try {
        const data = await fetch('/admin/failed-logins', { credentials: 'include' }).then(r => r.json());
        updateFailedLogins(data);
    } catch (error) {
        console.error('Failed to refresh failed logins:', error);
    }
}

async function refreshPerformance() {
    try {
        const data = await fetch('/admin/performance', { credentials: 'include' }).then(r => r.json());
        updatePerformance(data);
    } catch (error) {
        console.error('Failed to refresh performance:', error);
    }
}

async function refreshSystemStatus() {
    try {
        const data = await fetch('/admin/status', { credentials: 'include' }).then(r => r.json());
        updateSystemStatus(data);
    } catch (error) {
        console.error('Failed to refresh system status:', error);
    }
}

// Update main metrics
function updateMainMetrics(dashboard) {
    const container = document.getElementById('metricsContainer');
    if (!container) {
        console.warn('metricsContainer not found');
        return;
    }
    
    if (!dashboard || !dashboard.metrics) {
        container.innerHTML = '<p>Loading metrics...</p>';
        return;
    }
    
    const metrics = dashboard.metrics;
    const api = metrics.api || { totalRequests: 0, avgResponseTime: 0, failedRequests: 0, failureRate: 0 };
    const security = metrics.security || { failedLogins: 0, uniqueFailedUsers: 0 };
    const activity = metrics.activity || { visitorModifications: 0 };
    const lpr = metrics.lpr || { total_detections: 0, detections_today: 0, unique_plates: 0, unique_plates_today: 0, avg_confidence_all: 0, avg_confidence_today: null, cameras: [] };
    
    // Get last detection time overall
    let lastDetectionTime = 'N/A';
    if (lpr.cameras && lpr.cameras.length > 0) {
        const lastDetections = lpr.cameras
            .map(cam => cam.last_detection ? new Date(cam.last_detection) : null)
            .filter(d => d !== null)
            .sort((a, b) => b - a);
        
        if (lastDetections.length > 0) {
            const lastDate = lastDetections[0];
            const now = new Date();
            const diffMs = now - lastDate;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            
            if (diffMins < 60) {
                lastDetectionTime = `${diffMins} min ago`;
            } else if (diffHours < 24) {
                lastDetectionTime = `${diffHours} hrs ago`;
            } else {
                lastDetectionTime = lastDate.toLocaleString();
            }
        }
    }
    
    // Build camera status
    let cameraStatus = '';
    if (lpr.cameras && lpr.cameras.length > 0) {
        cameraStatus = lpr.cameras.map(cam => {
            let timeStr = 'No detections';
            if (cam.last_detection) {
                const lastDate = new Date(cam.last_detection);
                const now = new Date();
                const diffMs = now - lastDate;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                
                if (diffMins < 60) {
                    timeStr = `${diffMins}m ago`;
                } else if (diffHours < 24) {
                    timeStr = `${diffHours}h ago`;
                } else {
                    timeStr = lastDate.toLocaleDateString();
                }
            }
            return `<div style="font-size: 11px; margin: 5px 0;">
                <strong>${cam._id}:</strong> ${cam.count} detections (${timeStr})
            </div>`;
        }).join('');
    } else {
        cameraStatus = '<div style="font-size: 11px; color: #999;">No camera data</div>';
    }
    
    const html = `
        <div class="metric-card">
            <h3>API Requests (24h)</h3>
            <div class="metric-value">${api.totalRequests || 0}</div>
        </div>
        <div class="metric-card">
            <h3>Avg Response Time</h3>
            <div class="metric-value">${(api.avgResponseTime || 0).toFixed(0)}</div>
            <div class="metric-subtext">milliseconds</div>
        </div>
        <div class="metric-card">
            <h3>Failed Requests</h3>
            <div class="metric-value">${api.failedRequests || 0}</div>
            <div class="metric-subtext" style="color: ${(api.failureRate || 0) > 5 ? '#dc2626' : '#16a34a'}">
                ${(api.failureRate || 0).toFixed(2)}% failure rate
            </div>
        </div>
        <div class="metric-card">
            <h3>Failed Login Attempts</h3>
            <div class="metric-value">${security.failedLogins || 0}</div>
            <div class="metric-subtext">${security.uniqueFailedUsers || 0} unique users</div>
        </div>
        <div class="metric-card">
            <h3>Visitor Modifications</h3>
            <div class="metric-value">${activity.visitorModifications || 0}</div>
        </div>
        <!-- LPR metrics removed -->
    `;
    
    container.innerHTML = html;
}

// Update API health
function updateApiHealth(data) {
    const listEl = document.getElementById('endpointsList');
    if (!listEl) {
        console.warn('endpointsList element not found');
        return;
    }
    
    if (!data || !data.endpointStats) {
        listEl.innerHTML = '<tr><td colspan="5">No data available</td></tr>';
        return;
    }
    
    const stats = data.endpointStats || [];
    
    // Check for API failures and send alerts
    const failingEndpoints = stats.filter(s => {
        const successRate = parseFloat(s.successRate || 0);
        return successRate < 95; // Alert if success rate below 95%
    });
    
    if (failingEndpoints.length > 0) {
        const failureDetails = failingEndpoints.slice(0, 5).map(e => 
            `${e.endpoint}: ${e.successRate}% success (${e.failureCount || 0} failures)`
        );
        sendAnomalyAlert(
            'API_FAILURES',
            `🔴 API Health Issue Detected`,
            `${failingEndpoints.length} endpoint(s) with low success rates`,
            failureDetails
        );
    }
    
    // Update endpoints table
    const endpointHtml = stats.length > 0 
        ? stats.map(stat => {
            const successRate = parseFloat(stat.successRate || 0);
            const avgTime = parseFloat(stat.avgResponseTime || 0);
            const maxTime = parseFloat(stat.maxResponseTime || 0);
            return `
            <tr>
                <td><strong>${stat.endpoint || 'N/A'}</strong></td>
                <td>${stat.totalRequests || 0}</td>
                <td class="${getSuccessRateClass(successRate)}">${successRate.toFixed(1)}%</td>
                <td>${avgTime.toFixed(0)}ms</td>
                <td>${maxTime.toFixed(0)}ms</td>
            </tr>
        `;
        }).join('')
        : '<tr><td colspan="5">No endpoint data</td></tr>';
    
    listEl.innerHTML = endpointHtml;
    
    // Create health chart if we have data
    if (stats.length === 0) return;
    
    const labels = stats.slice(0, 10).map(s => (s.endpoint || 'unknown').split('/').pop());
    const successRates = stats.slice(0, 10).map(s => parseFloat(s.successRate || 0));
    
    if (charts.healthChart) charts.healthChart.destroy();
    
    const ctx = document.getElementById('healthChart');
    if (!ctx) {
        console.warn('healthChart element not found');
    } else {
        charts.healthChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Success Rate (%)',
                    data: successRates,
                    backgroundColor: '#06b6d4',
                    borderColor: '#0891b2',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { color: '#333' },
                        grid: { color: '#e0f8fa' }
                    },
                    x: {
                        ticks: { color: '#333' },
                        grid: { color: '#e0f8fa' }
                    }
                }
            }
        });
    }
    
    // Create trends chart
    const trends = data.hourlyTrends;
    if (trends && trends.length > 0) {
        if (charts.trendsChart) charts.trendsChart.destroy();
        
        const trendLabels = trends.map(t => new Date(t.timestamp).toLocaleTimeString());
        const ctx2 = document.getElementById('trendsChart');
        charts.trendsChart = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: trendLabels,
                datasets: [{
                    label: 'Error Rate (%)',
                    data: trends.map(t => parseFloat(t.errorRate)),
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    tension: 0.3
                }, {
                    label: 'Avg Response Time (ms)',
                    data: trends.map(t => parseFloat(t.avgResponseTime)),
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    tension: 0.3,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        ticks: { color: '#333' },
                        grid: { color: '#e0f8fa' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#333' },
                        grid: { drawOnChartArea: false }
                    },
                    x: {
                        ticks: { color: '#333' },
                        grid: { color: '#e0f8fa' }
                    }
                }
            }
        });
    }
}

// Update failed logins
function updateFailedLogins(data) {
    if (!data) {
        document.getElementById('failedLoginCount').textContent = '0';
        document.getElementById('uniqueFailedUsers').textContent = '0';
        document.getElementById('anomalyCount').textContent = '0';
        document.getElementById('ipThreats').textContent = '0';
        document.getElementById('emailAnomaliesList').innerHTML = '<tr><td colspan="6">No data</td></tr>';
        document.getElementById('ipAnomaliesList').innerHTML = '<tr><td colspan="4">No data</td></tr>';
        return;
    }
    
    const emailAnomalies = data.emailAnomalies || [];
    const ipAnomalies = data.ipAnomalies || [];
    const timeBased = data.timeBased || [];
    
    // Check for severe anomalies and send alerts
    const emailAnomalyList = emailAnomalies.filter(a => a.isAnomaly);
    const ipAnomalyList = ipAnomalies.filter(a => a.isAnomaly);
    
    if (emailAnomalyList.length > 0) {
        const anomalyDetails = emailAnomalyList.slice(0, 5).map(a => 
            `${a.email}: ${a.attempts} attempts from ${a.uniqueIPs} IPs`
        );
        sendAnomalyAlert(
            'EMAIL_ANOMALIES',
            `⚠️ Email Login Anomalies Detected`,
            `${emailAnomalyList.length} email(s) showing suspicious login patterns`,
            anomalyDetails
        );
    }
    
    if (ipAnomalyList.length > 0) {
        const anomalyDetails = ipAnomalyList.slice(0, 5).map(a => 
            `${a.ip}: ${a.attempts} attempts targeting ${a.targetedEmails} accounts`
        );
        sendAnomalyAlert(
            'IP_THREATS',
            `🚨 IP-Based Threats Detected`,
            `${ipAnomalyList.length} IP(s) showing malicious activity patterns`,
            anomalyDetails
        );
    }
    
    if (data.totalFailedLogins > 20) {
        sendAnomalyAlert(
            'HIGH_FAILED_LOGINS',
            `📊 High Volume of Failed Logins`,
            `${data.totalFailedLogins} failed login attempts in the last 24 hours`
        );
    }
    
    document.getElementById('failedLoginCount').textContent = data.totalFailedLogins || 0;
    document.getElementById('uniqueFailedUsers').textContent = emailAnomalies.length;
    
    const anomalies = emailAnomalies.filter(a => a.isAnomaly).length;
    document.getElementById('anomalyCount').textContent = anomalies;
    
    const ipThreats = ipAnomalies.filter(a => a.isAnomaly).length;
    document.getElementById('ipThreats').textContent = ipThreats;
    
    // Email anomalies table
    const emailHtml = emailAnomalies.length > 0
        ? emailAnomalies.slice(0, 10).map(anom => {
            const rowClass = anom.isAnomaly ? ' class="anomaly-row"' : '';
            return `
            <tr${rowClass}>
                <td>${anom.email || 'N/A'}</td>
                <td>${anom.attempts || 0}</td>
                <td>${anom.uniqueIPs || 0}</td>
                <td>${new Date(anom.firstAttempt).toLocaleString()}</td>
                <td>${new Date(anom.lastAttempt).toLocaleString()}</td>
                <td>${anom.isAnomaly ? '⚠️ ANOMALY' : '✓ Normal'}</td>
            </tr>
        `;
        }).join('')
        : '<tr><td colspan="6">No email anomalies</td></tr>';
    
    document.getElementById('emailAnomaliesList').innerHTML = emailHtml;
    
    // IP anomalies table
    const ipHtml = ipAnomalies.length > 0
        ? ipAnomalies.slice(0, 10).map(anom => {
            const rowClass = anom.isAnomaly ? ' class="anomaly-row"' : '';
            return `
            <tr${rowClass}>
                <td><code>${anom.ip || 'N/A'}</code></td>
                <td>${anom.attempts || 0}</td>
                <td>${anom.targetedEmails || 0}</td>
                <td>${anom.isAnomaly ? '⚠️ THREAT' : '✓ Normal'}</td>
            </tr>
        `;
        }).join('')
        : '<tr><td colspan="4">No IP anomalies</td></tr>';
    
    document.getElementById('ipAnomaliesList').innerHTML = ipHtml;

    // Chart for timeline pattern
    if (timeBased && Array.isArray(timeBased) && timeBased.length > 0) {
        try {
            if (charts.timelineChart) {
                charts.timelineChart.destroy();
            }
            
            const timeLabels = timeBased.map(t => new Date(t.timestamp).toLocaleTimeString());
            const ctx = document.getElementById('timelineChart');
            if (ctx) {
                charts.timelineChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: timeLabels,
                        datasets: [{
                            label: 'Failed Attempts',
                            data: timeBased.map(t => t.attemptCount),
                            backgroundColor: timeBased.map(t => t.isSpike ? '#dc2626' : '#06b6d4')
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                ticks: { color: '#333' },
                                grid: { color: '#e0f8fa' }
                            },
                            x: {
                                ticks: { color: '#333' },
                                grid: { color: '#e0f8fa' }
                            }
                        }
                    }
                });
            }
        } catch (err) {
            console.error('Error creating timeline chart:', err);
        }
    }
}

// Update performance
function updatePerformance(data) {
    if (!data) {
        document.getElementById('totalRequests').textContent = '0';
        document.getElementById('avgLatency').textContent = '0';
        document.getElementById('bottleneckCount').textContent = '0';
        document.getElementById('performanceList').innerHTML = '<tr><td colspan="6">No data</td></tr>';
        return;
    }
    
    const performanceByEndpoint = data.performanceByEndpoint || [];
    const bottlenecks = data.bottlenecks || [];
    
    document.getElementById('totalRequests').textContent = data.totalRequests || 0;
    
    const avgLatency = performanceByEndpoint.length > 0
        ? performanceByEndpoint[0].avgLatency || 0
        : 0;
    document.getElementById('avgLatency').textContent = (avgLatency || 0).toFixed(0);
    document.getElementById('bottleneckCount').textContent = bottlenecks.length;
    
    // Performance table
    const perfHtml = performanceByEndpoint.length > 0
        ? performanceByEndpoint.slice(0, 15).map(perf => `
            <tr>
                <td><strong>${perf.endpoint || 'N/A'}</strong></td>
                <td>${perf.requestCount || 0}</td>
                <td>${((perf.avgLatency || 0).toFixed(0))}ms</td>
                <td>${((perf.p95 || 0).toFixed(0))}ms</td>
                <td>${((perf.p99 || 0).toFixed(0))}ms</td>
                <td class="${getSlowPercentageClass(perf.slowPercentage || 0)}">${(perf.slowPercentage || 0)}%</td>
            </tr>
        `).join('')
        : '<tr><td colspan="6">No performance data</td></tr>';
    
    document.getElementById('performanceList').innerHTML = perfHtml;
}

// Update system status
function updateSystemStatus(status) {
    if (!status) {
        document.getElementById('systemStatus').textContent = 'UNKNOWN';
        document.getElementById('statusContainer').innerHTML = '<p>No status data available</p>';
        return;
    }
    
    const statusBadge = document.getElementById('systemStatus');
    statusBadge.textContent = status.systemStatus || 'UNKNOWN';
    statusBadge.className = `status-badge status-${(status.systemStatus || 'unknown').toLowerCase()}`;
    
    const components = status.components || { database: {}, api: {}, authentication: {} };
    
    const dbColor = (components.database || {}).status === 'CONNECTED' ? '#16a34a' : '#dc2626';
    const apiColor = (components.api || {}).status === 'OPERATIONAL' ? '#16a34a' : '#dc2626';
    const secColor = (components.security || {}).status === 'NORMAL' ? '#16a34a' : '#dc2626';
    
    const statusHtml = `
        <div class="metric-card">
            <h3>Database</h3>
            <div style="font-size: 18px; font-weight: bold; color: ${dbColor};">
                ${(components.database || {}).status || 'UNKNOWN'}
            </div>
        </div>
        <div class="metric-card">
            <h3>API Status</h3>
            <div style="font-size: 18px; font-weight: bold; color: ${apiColor};">
                ${(components.api || {}).status || 'UNKNOWN'}
            </div>
            <div class="metric-subtext">Last hour: ${(components.api || {}).requestsLastHour || 0} requests</div>
        </div>
        <div class="metric-card">
            <h3>Security Status</h3>
            <div style="font-size: 18px; font-weight: bold; color: ${secColor};">
                ${(components.security || {}).status || 'UNKNOWN'}
            </div>
            <div class="metric-subtext">Failed attempts (5m): ${(components.security || {}).failedLoginAttemptsLast5Min || 0}</div>
        </div>
    `;
    
    document.getElementById('statusDetails').innerHTML = statusHtml;
}

// Update alerts
function updateAlerts(dashboard, status) {
    const alerts = [];
    
    if (status.systemStatus === 'ALERT' || status.systemStatus === 'CRITICAL') {
        status.issues.forEach(issue => {
            alerts.push({
                type: status.systemStatus === 'CRITICAL' ? 'error' : 'warning',
                message: issue
            });
        });
    }
    
    if (dashboard.metrics.api.failureRate > 10) {
        alerts.push({
            type: 'error',
            message: `High API failure rate: ${dashboard.metrics.api.failureRate}%`
        });
    }
    
    if (dashboard.metrics.security.failedLogins > 10) {
        alerts.push({
            type: 'warning',
            message: `High failed login attempts: ${dashboard.metrics.security.failedLogins}`
        });
    }
    
    const alertsContainer = document.getElementById('alertsContainer');
    if (alerts.length > 0) {
        const alertsHtml = alerts.map(alert => `
            <div class="alert-box ${alert.type}">
                <h4>${alert.type === 'error' ? '❌ Error' : '⚠️ Warning'}</h4>
                <p>${alert.message}</p>
            </div>
        `).join('');
        
        alertsContainer.innerHTML = alertsHtml;
        alertsContainer.style.display = 'block';
    } else {
        alertsContainer.style.display = 'none';
    }
}

// Utility functions
function getSuccessRateClass(rate) {
    if (rate >= 95) return 'error-rate-low';
    if (rate >= 90) return 'error-rate-med';
    return 'error-rate-high';
}

function getSlowPercentageClass(percentage) {
    if (percentage > 20) return 'error-rate-high';
    if (percentage > 10) return 'error-rate-med';
    return 'error-rate-low';
}

function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
}

function switchSecurityTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('#summary, #anomalies, #timeline').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    event.target.classList.add('active');
}

function showError(message) {
    console.error('ERROR:', message);
    const alertsContainer = document.getElementById('alertsContainer');
    if (!alertsContainer) {
        // If container doesn't exist, create a visible alert at the top
        const div = document.createElement('div');
        div.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; background: #dc2626; color: white; padding: 20px; font-size: 16px; z-index: 9999;';
        div.textContent = '❌ ERROR: ' + message;
        document.body.appendChild(div);
        return;
    }
    alertsContainer.innerHTML = `
        <div class="alert-box error" style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 15px; margin-bottom: 20px;">
            <h4 style="color: #dc2626; margin: 0 0 10px 0;">❌ Error Loading Dashboard</h4>
            <p style="margin: 0; color: #7f1d1d;">${message}</p>
        </div>
    `;
    alertsContainer.style.display = 'block';
}
// Refresh health metrics
async function refreshHealthMetrics() {
    try {
        // Get dashboard data for uptime and error rate
        const response = await fetch('/admin/dashboard', { credentials: 'include' });
        
        if (!response.ok) {
            throw new Error(`Dashboard API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        // Set default values first
        document.getElementById('errorRate24h').textContent = '0%';
        document.getElementById('avgResponseTime').textContent = '0ms';
        document.getElementById('systemUptime').textContent = '100%';
        document.getElementById('uptimePercent').textContent = 'Current';
        
        // Update with actual data if available
        if (data && data.metrics && data.metrics.api) {
            const totalRequests = data.metrics.api.totalRequests || 1;
            const failedRequests = data.metrics.api.failedRequests || 0;
            const errorRate = data.metrics.api.failureRate || 0;
            
            document.getElementById('errorRate24h').textContent = errorRate.toFixed(1) + '%';
            document.getElementById('avgResponseTime').textContent = (data.metrics.api.avgResponseTime || 0).toFixed(0) + 'ms';
            document.getElementById('systemUptime').textContent = '99.9%';
            document.getElementById('uptimePercent').textContent = 'Last 24 hours';
        }
        
        // Note: Error history chart requires additional API data not currently available
        // The dashboard API only returns aggregated metrics for the last 24 hours
        // To implement error trend over time, we would need to collect historical data from api_health collection
        // Update uptime status with actual system info
        const uptimeStatus = document.getElementById('uptimeStatus');
        if (uptimeStatus) {
            if (data && data.metrics && data.metrics.api) {
                uptimeStatus.innerHTML = `
                    <h4 style="margin-top: 0;">System Status - Last 24 Hours</h4>
                    <p><strong>API Response:</strong> ${(data.metrics.api.avgResponseTime || 0).toFixed(0)}ms average</p>
                    <p><strong>Failed Requests:</strong> ${data.metrics.api.failedRequests || 0} out of ${data.metrics.api.totalRequests || 0}</p>
                    <p><strong>Error Rate:</strong> ${(data.metrics.api.failureRate || 0).toFixed(1)}%</p>
                    <p><strong>Failed Logins:</strong> ${data.metrics.security?.failedLogins || 0}</p>
                    <p><strong>Last Updated:</strong> ${new Date().toLocaleTimeString()}</p>
                `;
            } else {
                uptimeStatus.innerHTML = `
                    <h4 style="margin-top: 0;">System Status</h4>
                    <p style="color: #999;">No data available</p>
                `;
            }
        }
    } catch (error) {
        console.error('Error refreshing health metrics:', error);
        // Set safe defaults on error
        document.getElementById('errorRate24h').textContent = 'N/A';
        document.getElementById('avgResponseTime').textContent = 'N/A';
        document.getElementById('systemUptime').textContent = 'N/A';
        document.getElementById('uptimePercent').textContent = 'Error loading data';
        const uptimeStatus = document.getElementById('uptimeStatus');
        if (uptimeStatus) {
            uptimeStatus.innerHTML = '<p style="color: #dc2626;">Unable to load system status</p>';
        }
    }
}

// Refresh database health
async function refreshDatabaseHealth() {
    try {
        const response = await fetch('/admin/db-health', { credentials: 'include' });
        
        if (!response.ok) {
            throw new Error(`DB Health API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        // Set default values first
        const statusElement = document.getElementById('dbStatus');
        statusElement.textContent = '⏳ CHECKING';
        statusElement.style.color = '#f59e0b';
        statusElement.style.fontWeight = 'bold';
        document.getElementById('activeConnections').textContent = '0';
        document.getElementById('connectionAverage').textContent = 'Avg: 0';
        document.getElementById('avgQueryTime').textContent = '0ms';
        document.getElementById('storageUsed').textContent = '0 GB';
        document.getElementById('storageSummary').textContent = 'Data: 0GB | Index: 0GB';
        document.getElementById('operationsStats').innerHTML = '<tr><td colspan="2">No data</td></tr>';
        
        if (data && data.status === 'CONNECTED') {
            document.getElementById('dbStatus').textContent = '✅ HEALTHY';
            document.getElementById('dbStatus').style.color = '#10b981';
            document.getElementById('dbStatus').style.fontWeight = 'bold';
            document.getElementById('activeConnections').textContent = data.connections?.current || 0;
            document.getElementById('connectionAverage').textContent = `Avg: ${data.connections?.avgActive || 0}`;
            document.getElementById('avgQueryTime').textContent = (data.performance?.avgQueryTime || 0).toFixed(1) + 'ms';
            
            // Format storage (handle 0 values gracefully)
            const totalSize = data.storage?.totalSize || 0;
            const dataSize = data.storage?.dataSize || 0;
            const indexSize = data.storage?.indexSize || 0;
            
            const storageGB = (totalSize / (1024 * 1024 * 1024)).toFixed(3);
            const dataGB = (dataSize / (1024 * 1024 * 1024)).toFixed(3);
            const indexGB = (indexSize / (1024 * 1024 * 1024)).toFixed(3);
            
            document.getElementById('storageUsed').textContent = storageGB + ' GB';
            document.getElementById('storageSummary').textContent = `Data: ${dataGB}GB | Index: ${indexGB}GB`;
            
            // Operations stats
            const ops = data.operations || {};
            const opsHtml = `
                <tr><td>Inserts</td><td>${ops.insert || 0}</td></tr>
                <tr><td>Updates</td><td>${ops.update || 0}</td></tr>
                <tr><td>Deletes</td><td>${ops.delete || 0}</td></tr>
                <tr><td>Queries</td><td>${ops.query || 0}</td></tr>
            `;
            document.getElementById('operationsStats').innerHTML = opsHtml;
            
            // Create database performance chart
            if (data.performance?.recentRecords && data.performance.recentRecords.length > 0) {
                const records = data.performance.recentRecords.reverse();
                const times = records.map(r => r.avgQueryTime || 0);
                const labels = records.map((r, i) => {
                    try {
                        return new Date(r.timestamp).toLocaleTimeString();
                    } catch (e) {
                        return `${i}m ago`;
                    }
                });
                
                if (charts.dbPerformanceChart) charts.dbPerformanceChart.destroy();
                const ctx = document.getElementById('dbPerformanceChart');
                if (ctx) {
                    charts.dbPerformanceChart = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: labels,
                            datasets: [{
                                label: 'Query Time (ms)',
                                data: times,
                                borderColor: '#06b6d4',
                                backgroundColor: 'rgba(6, 182, 212, 0.1)',
                                tension: 0.3,
                                fill: true
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                y: { ticks: { color: '#333' }, grid: { color: '#e0f8fa' } },
                                x: { ticks: { color: '#333' }, grid: { color: '#e0f8fa' } }
                            }
                        }
                    });
                }
            }
        } else if (data && data.status === 'ERROR') {
            const errorElement = document.getElementById('dbStatus');
            errorElement.textContent = '❌ ERROR: ' + (data.error || 'Unknown');
            errorElement.style.color = '#ef4444';
            errorElement.style.fontWeight = 'bold';
        } else {
            const warningElement = document.getElementById('dbStatus');
            warningElement.textContent = '⚠️ NO DATA';
            warningElement.style.color = '#f59e0b';
            warningElement.style.fontWeight = 'bold';
        }
    } catch (error) {
        console.error('Error refreshing database health:', error);
        const errorElement = document.getElementById('dbStatus');
        errorElement.textContent = '❌ ERROR: ' + error.message;
        errorElement.style.color = '#ef4444';
        errorElement.style.fontWeight = 'bold';
    }
}

// ==================== SESSION MANAGEMENT ====================

// Store all sessions in memory for filtering
let allSessions = [];

async function refreshSessions() {
    try {
        const sessionsList = document.getElementById('sessionsList');
        if (!sessionsList) {
            console.warn('Sessions list element not found, skipping sessions refresh');
            return;
        }
        
        const response = await fetch('/admin/sessions');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        allSessions = await response.json();
        
        // Update session count badge
        const sessionCountBadge = document.getElementById('sessionCountBadge');
        if (sessionCountBadge) {
            sessionCountBadge.textContent = allSessions.length;
        }
        
        filterSessions(); // Apply any active filters
    } catch (error) {
        console.error('Error refreshing sessions:', error);
        const sessionsList = document.getElementById('sessionsList');
        if (sessionsList) {
            sessionsList.innerHTML = `
                <tr><td colspan="6" style="text-align: center; color: red; padding: 20px;">
                    ❌ Error: ${error.message}
                </td></tr>
            `;
        }
    }
}

function filterSessions() {
    const emailFilterEl = document.getElementById('sessionEmailFilter');
    const ipFilterEl = document.getElementById('sessionIPFilter');
    
    // Return early if elements don't exist yet
    if (!emailFilterEl || !ipFilterEl) {
        console.warn('Session filter elements not found, skipping filter');
        return;
    }
    
    const emailFilter = emailFilterEl.value.toLowerCase();
    const ipFilter = ipFilterEl.value.toLowerCase();
    
    let filtered = allSessions.filter(session => {
        const emailMatch = session.email.toLowerCase().includes(emailFilter);
        const ipMatch = session.ipAddress.toLowerCase().includes(ipFilter);
        return emailMatch && ipMatch;
    });
    
    let html = '';
    
    if (filtered.length === 0) {
        html = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No sessions match filters</td></tr>';
    } else {
        html = filtered.map(session => {
            const loginTime = new Date(session.loginTime).toLocaleString();
            const lastActivity = new Date(session.lastActivity).toLocaleString();
            
            // Calculate idle time
            const now = new Date();
            const lastActivityDate = new Date(session.lastActivity);
            const idleMs = now - lastActivityDate;
            const idleMinutes = Math.floor(idleMs / 60000);
            const idleHours = Math.floor(idleMinutes / 60);
            const idleDays = Math.floor(idleHours / 24);
            
            let idleTimeText = '';
            if (idleDays > 0) {
                idleTimeText = `${idleDays}d ${idleHours % 24}h`;
            } else if (idleHours > 0) {
                idleTimeText = `${idleHours}h ${idleMinutes % 60}m`;
            } else {
                idleTimeText = `${idleMinutes}m`;
            }
            
            return `
                <tr>
                    <td style="padding: 10px 15px;"><strong>${session.email}</strong></td>
                    <td style="padding: 10px 15px;">${loginTime}</td>
                    <td style="padding: 10px 15px;">${lastActivity}</td>
                    <td style="padding: 10px 15px;"><span style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-weight: 500;">${idleTimeText}</span></td>
                    <td style="padding: 10px 15px;"><code style="font-size: 12px;">${session.ipAddress}</code></td>
                    <td style="padding: 10px 15px;">
                        <button class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;" 
                            data-session-id="${session.sessionId}" 
                            data-email="${session.email}"
                            onclick="revokeSession(this.dataset.sessionId, this.dataset.email)">
                            Revoke
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    document.getElementById('sessionsList').innerHTML = html;
}

async function revokeSession(sessionId, email) {
    console.log(`📍 DEBUG: revokeSession called with sessionId="${sessionId}" email="${email}"`);
    
    if (!confirm(`Are you sure you want to revoke the session for ${email}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/sessions/${sessionId}/revoke`, {
            method: 'POST'
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        if (result.success) {
            alert(`✅ Session revoked for ${email}`);
            await refreshSessions();
        } else {
            alert(`❌ Failed to revoke session: ${result.error}`);
        }
    } catch (error) {
        console.error('Error revoking session:', error);
        alert(`❌ Error: ${error.message}`);
    }
}

async function revokeAllSessions() {
    const count = allSessions ? allSessions.length : 0;
    if (!confirm(`⚠️ WARNING: This will revoke ALL ${count} active sessions!\n\nContinue?`)) {
        return;
    }
    
    try {
        console.log('Revoking all sessions...');
        const response = await fetch('/admin/sessions/revoke-all', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const result = await response.json();
        if (result.success) {
            alert(`✅ All sessions revoked! Revoked: ${result.revokedCount}`);
            await refreshSessions();
        } else {
            alert(`❌ Failed to revoke sessions: ${result.error}`);
        }
    } catch (error) {
        console.error('Error revoking all sessions:', error);
        alert(`❌ Error: ${error.message}`);
    }
}

// ==================== AUDIT LOG ====================

// Store all audit logs in memory for filtering
let allAuditLogs = [];

async function refreshAuditLog() {
    try {
        const auditLogList = document.getElementById('auditLogList');
        if (!auditLogList) {
            console.warn('Audit log list element not found, skipping audit log refresh');
            return;
        }
        
        const response = await fetch('/admin/audit-logs?limit=50');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        allAuditLogs = await response.json();
        filterAuditLogs(); // Apply any active filters
    } catch (error) {
        console.error('Error refreshing audit log:', error);
        const auditLogList = document.getElementById('auditLogList');
        if (auditLogList) {
            auditLogList.innerHTML = `
                <tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">
                    ❌ Error: ${error.message}
                </td></tr>
            `;
        }
    }
}

function filterAuditLogs() {
    const emailFilterEl = document.getElementById('auditEmailFilter');
    const actionFilterEl = document.getElementById('auditActionFilter');
    const timeFilterEl = document.getElementById('auditTimeFilter');
    
    // Return early if elements don't exist yet
    if (!emailFilterEl || !actionFilterEl || !timeFilterEl) {
        console.warn('Audit log filter elements not found, skipping filter');
        return;
    }
    
    const emailFilter = emailFilterEl.value.toLowerCase();
    const actionFilter = actionFilterEl.value;
    const timeFilter = timeFilterEl.value;
    
    const now = new Date();
    let cutoffTime = new Date(0); // All time by default
    
    if (timeFilter === '7d') {
        cutoffTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeFilter === '30d') {
        cutoffTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeFilter === '60d') {
        cutoffTime = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    } else if (timeFilter === '90d') {
        cutoffTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }
    
    let filtered = allAuditLogs.filter(log => {
        if (!log || !log.email) return false; // Skip logs without email
        const emailMatch = log.email.toLowerCase().includes(emailFilter);
        const actionMatch = !actionFilter || log.action === actionFilter;
        const timeMatch = new Date(log.timestamp) >= cutoffTime;
        return emailMatch && actionMatch && timeMatch;
    });
    
    let html = '';
    
    if (filtered.length === 0) {
        html = '<tr><td colspan="5" style="text-align: center; padding: 20px;">No audit logs match filters</td></tr>';
    } else {
        html = filtered.map(log => {
            const timestamp = new Date(log.timestamp).toLocaleString();
            const userName = log.userName || '-';
            
            // Format details in human-readable way
            let detailsStr = '-';
            if (log.details) {
                if (typeof log.details === 'object') {
                    // Extract key info from details object
                    const parts = [];
                    if (log.details.plate) parts.push(`Plate: ${log.details.plate}`);
                    if (log.details.visitor_name) parts.push(`Visitor: ${log.details.visitor_name}`);
                    if (log.details.invitee_email) parts.push(`Invitee: ${log.details.invitee_email}`);
                    if (log.details.user_id) parts.push(`User ID: ${log.details.user_id}`);
                    if (log.details.ip) parts.push(`IP: ${log.details.ip}`);
                    detailsStr = parts.length > 0 ? parts.join(' | ') : JSON.stringify(log.details).substring(0, 60);
                } else {
                    detailsStr = String(log.details).substring(0, 60);
                }
            }
            
            // Color code actions
            let actionColor = '#06b6d4';
            if (log.action === 'SESSION_REVOKED') actionColor = '#ef4444';
            
            return `
                <tr>
                    <td style="padding: 10px 20px;"><code style="font-size: 12px;">${timestamp}</code></td>
                    <td style="padding: 10px 20px;"><strong>${log.email}</strong></td>
                    <td style="padding: 10px 20px;"><strong>${userName}</strong></td>
                    <td style="padding: 10px 20px;"><span style="color: ${actionColor}; font-weight: bold;">${log.action}</span></td>
                    <td style="padding: 10px 20px;"><span style="font-size: 13px;">${detailsStr}</span></td>
                </tr>
            `;
        }).join('');
    }
    
    document.getElementById('auditLogList').innerHTML = html;
}

// Comprehensive Metrics
let activityByDayChart = null;

async function refreshComprehensiveMetrics() {
    try {
        const response = await fetch('/admin/comprehensive-metrics', { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const metrics = await response.json();
        
        // User Activity
        document.getElementById('metric-activeUsers7d').textContent = metrics.userActivity.activeUsersLast7d;
        document.getElementById('metric-activeUsers30d').textContent = metrics.userActivity.activeUsersLast30d;
        document.getElementById('metric-actionsToday').textContent = metrics.userActivity.actionsToday;
        
        // License Plates
        document.getElementById('metric-totalPlates').textContent = metrics.licensePlates.total;
        document.getElementById('metric-platesAddedToday').textContent = metrics.licensePlates.addedToday;
        document.getElementById('metric-platesRemovedToday').textContent = metrics.licensePlates.removedToday;
        
        // PIN Management
        document.getElementById('metric-pinChangesToday').textContent = metrics.pins.changedToday;
        
        // Visitor Management
        document.getElementById('metric-totalVisitors').textContent = metrics.visitors.total;
        document.getElementById('metric-visitorsAddedToday').textContent = metrics.visitors.modifiedToday;
        document.getElementById('metric-expiringVisitors').textContent = metrics.visitors.expiringNext7Days;
        
        // Display expiring visitors
        if (metrics.visitors.expiringList.length > 0) {
            const expiringList = metrics.visitors.expiringList.map(v => {
                const endDate = new Date(v.endDate).toLocaleDateString();
                return `<div style="padding: 8px; background: #fee2e2; border-radius: 4px; margin-bottom: 8px;">
                    <strong>${v.name}</strong> - Expires: ${endDate}
                </div>`;
            }).join('');
            document.getElementById('expiringVisitorsList').innerHTML = `<h4>⚠️ Expiring Soon:</h4>${expiringList}`;
        } else {
            document.getElementById('expiringVisitorsList').innerHTML = '';
        }
        
        // Authentication Health
        document.getElementById('metric-failedLogins').textContent = metrics.authentication.failedLoginsLast24h;
        document.getElementById('metric-invalidEmailAttempts').textContent = metrics.authentication.invalidEmailAttempts;
        
        // Invitations
        document.getElementById('metric-pendingInvites').textContent = metrics.invitations.pending;
        document.getElementById('metric-invitesSentToday').textContent = metrics.invitations.sentToday;
        document.getElementById('metric-acceptedToday').textContent = metrics.invitations.acceptedToday;
        
        // System Health
        let lastSyncText = 'Never';
        if (metrics.systemHealth.lastSyncTime && metrics.systemHealth.lastSyncTime !== 'Never') {
            try {
                lastSyncText = new Date(metrics.systemHealth.lastSyncTime).toLocaleString();
            } catch (e) {
                lastSyncText = metrics.systemHealth.lastSyncTime;
            }
        }
        document.getElementById('metric-lastSync').textContent = lastSyncText;
        
        // Top Users - filter out null names
        const validTopUsers = metrics.topUsers.filter(u => u.name && u.name.trim());
        const topUsersHtml = validTopUsers.length > 0 ? 
            validTopUsers.map(u => `
                <tr>
                    <td><strong>${u.name}</strong></td>
                    <td>${u.count}</td>
                </tr>
            `).join('') :
            '<tr><td colspan="2" style="text-align: center; padding: 20px;">No activity</td></tr>';
        document.getElementById('topUsersList').innerHTML = topUsersHtml;
        
        // Top Actions - filter out null/empty actions
        const validTopActions = metrics.topActions.filter(a => a._id && a._id.trim());
        const topActionsHtml = validTopActions.length > 0 ?
            validTopActions.map(a => `
                <tr>
                    <td><strong>${a._id}</strong></td>
                    <td>${a.count}</td>
                </tr>
            `).join('') :
            '<tr><td colspan="2" style="text-align: center; padding: 20px;">No activity</td></tr>';
        document.getElementById('topActionsList').innerHTML = topActionsHtml;
        
        // Activity by Day Chart
        if (metrics.activityByDay && metrics.activityByDay.length > 0) {
            const ctx = document.getElementById('activityByDayChart');
            if (ctx) {
                const labels = metrics.activityByDay.map(d => d._id);
                const data = metrics.activityByDay.map(d => d.count);
                
                if (activityByDayChart) {
                    activityByDayChart.destroy();
                }
                
                activityByDayChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'User Actions',
                            data: data,
                            borderColor: '#2563eb',
                            backgroundColor: 'rgba(37, 99, 235, 0.1)',
                            tension: 0.4,
                            fill: true,
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: { display: true }
                        },
                        scales: {
                            y: { beginAtZero: true }
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error loading comprehensive metrics:', error);
    }
}

/* LPR service health UI removed */

/* LPR control functions removed */

/* LPR fetch/match job functions removed */

/* LPR modal and applyMatches removed */

