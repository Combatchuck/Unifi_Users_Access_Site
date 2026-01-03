// Load and initialize shared header on all pages
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Inject header HTML at the beginning of body
        const headerHTML = `
        <nav class="navbar-standard">
            <div class="navbar-container">
                <div class="navbar-left">
                    <a href="/" class="nav-brand">🏠 Home</a>
                    <a href="/admin.html" id="adminLink" class="nav-link" style="display: none;">📊 Admin Dashboard</a>
                    <a href="/lpr-dashboard.html" id="lprLink" class="nav-link" style="display: none;">🚗 LPR Query</a>
                </div>
                <div class="navbar-right">
                    <div class="dark-mode-toggle-header">
                        <span>🌙 Dark Mode</span>
                        <div class="toggle-switch" id="darkModeToggle"></div>
                    </div>
                    <button id="logoutBtn" class="nav-logout" style="display: none;">Logout</button>
                </div>
            </div>
        </nav>
        `;
        
        // Insert header at the very beginning of body
        document.body.insertAdjacentHTML('afterbegin', headerHTML);
        
        // Initialize header functionality
        initializeSharedHeader();
    } catch (error) {
        console.error('Failed to load header:', error);
    }
});

function initializeSharedHeader() {
    // Check if user is authenticated
    fetch('/api/check-session')
        .then(r => r.json())
        .then(data => {
            console.log('[HEADER] Check session response:', data);
            const currentPage = window.location.pathname;
            const isAdminPage = currentPage.includes('/admin') || currentPage.includes('/lpr-dashboard');
            
            // Get nav elements
            const navbarLeft = document.querySelector('.navbar-left');
            const navbarRight = document.querySelector('.navbar-right');
            const homeLink = document.querySelector('a[href="/"]');
            const adminLink = document.getElementById('adminLink');
            const lprLink = document.getElementById('lprLink');
            const logoutBtn = document.getElementById('logoutBtn');
            
            if (data.authenticated) {
                // Show navbar when authenticated
                if (navbarLeft) navbarLeft.style.display = 'flex';
                if (navbarRight) navbarRight.style.display = 'flex';
                
                // Show logout button
                if (logoutBtn) logoutBtn.style.display = 'block';
                
                // Highlight active nav link
                if (homeLink) homeLink.classList.remove('active');
                if (adminLink) adminLink.classList.remove('active');
                if (lprLink) lprLink.classList.remove('active');
                
                if (currentPage === '/' || currentPage === '/index.html') {
                    if (homeLink) homeLink.classList.add('active');
                } else if (currentPage.includes('/admin')) {
                    if (adminLink) adminLink.classList.add('active');
                } else if (currentPage.includes('/lpr-dashboard')) {
                    if (lprLink) lprLink.classList.add('active');
                }
                
                // Show admin links if user is admin
                if (data.isAdmin) {
                    console.log('[HEADER] User is admin, showing admin links');
                    // Respect site configuration for LPR visibility
                    fetch('/api/site-info').then(r => r.ok ? r.json() : null).then(site => {
                        const showLpr = !(site && site.showLprData === false);
                        if (adminLink) adminLink.style.display = 'inline-block';
                        if (lprLink) {
                            if (showLpr) lprLink.style.display = 'inline-block';
                            else lprLink.style.display = 'none';
                        }
                    }).catch(err => {
                        // Default: show links if fetch fails
                        if (adminLink) adminLink.style.display = 'inline-block';
                        if (lprLink) lprLink.style.display = 'inline-block';
                    });
                } else {
                    console.log('[HEADER] User is NOT admin');
                    // Non-admin trying to access admin page - redirect
                    if (isAdminPage) {
                        console.warn('Unauthorized: Non-admin accessing admin page');
                        window.location.href = '/';
                        return;
                    }
                }
            } else {
                // Not authenticated - show limited header (don't hide entire navbar)
                console.log('[HEADER] User not authenticated - showing limited header');
                if (navbarLeft) navbarLeft.style.display = 'flex';
                if (navbarRight) navbarRight.style.display = 'flex';
                if (logoutBtn) logoutBtn.style.display = 'none';
                if (adminLink) adminLink.style.display = 'none';
                if (lprLink) lprLink.style.display = 'none';
                
                if (isAdminPage) {
                    // Redirect to login for admin pages
                    window.location.href = '/';
                }
            }
        })
        .catch(err => {
            console.log('Session check failed:', err);
            // Hide navbar on error
            const navbarLeft = document.querySelector('.navbar-left');
            const navbarRight = document.querySelector('.navbar-right');
            if (navbarLeft) navbarLeft.style.display = 'none';
            if (navbarRight) navbarRight.style.display = 'none';
            
            // Redirect to home on session check failure
            if (window.location.pathname.includes('/admin') || window.location.pathname.includes('/lpr-dashboard')) {
                window.location.href = '/';
            }
        });

    // Dark mode toggle functionality
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) {
        toggle.addEventListener('click', toggleDarkMode);
    }

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            fetch('/logout', { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                    window.location.href = '/';
                })
                .catch(err => {
                    console.error('Logout failed:', err);
                    window.location.href = '/';
                });
        });
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const toggle = document.getElementById('darkModeToggle');
    toggle.classList.toggle('on');
    
    // Save preference to server
    const isDark = document.body.classList.contains('dark-mode');
    fetch('/api/dark-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isDark })
    }).catch(err => console.error('Dark mode save failed:', err));
}

// Export function to reinitialize header after login
function reinitializeHeader() {
    initializeSharedHeader();
}
