// Dark mode functionality


let currentVisitor = null;


window.openEditVisitorModal = async function(visitorId) {
    console.log('Opening edit modal for visitor:', visitorId);
    try {
        const response = await fetch(`/api/visitors/${visitorId}`);
        console.log('Response status:', response.status);
        if (!response.ok) {
            alert('Failed to load visitor details: ' + response.status);
            return;
        }
        currentVisitor = await response.json();
        console.log('Visitor data loaded:', currentVisitor);
        const visitor = currentVisitor.data || currentVisitor;
        
        document.getElementById('editVisitorTitle').textContent = `Edit Visitor - ${visitor.first_name} ${visitor.last_name}`;
        document.getElementById('editFirstName').value = visitor.first_name;
        document.getElementById('editLastName').value = visitor.last_name;
        
        const createdDate = new Date(visitor.create_time * 1000).toLocaleDateString('en-US');
        document.getElementById('editVisitorCreated').textContent = createdDate;
        
        const startDate = new Date(visitor.start_time * 1000).toISOString().split('T')[0];
        const endDate = new Date(visitor.end_time * 1000).toISOString().split('T')[0];
        
        document.getElementById('editStartDate').value = startDate;
        document.getElementById('editEndDate').value = endDate;
        document.getElementById('editRemarks').value = visitor.remarks || '';
        
        // Render schedule
        window.renderSchedule(visitor);
        
        let plateLastSeenMap = {};
        if (window._showLprData !== false) {
            try {
                const response = await fetch(`/api/visitor-last-seen/${visitor.id}`);
                if (response.ok) {
                    const data = await response.json();
                    data.plateDetails.forEach(pd => {
                        plateLastSeenMap[pd.plate] = pd.lastSeen;
                    });
                }
            } catch (error) {
                console.error('Error fetching plate last seen:', error);
            }
        }
        
        const platesContainer = document.getElementById('editVisitorPlates');
        platesContainer.innerHTML = '';
        if (visitor.license_plates && visitor.license_plates.length > 0) {
            visitor.license_plates.forEach(plate => {
                const plateDiv = document.createElement('div');
                plateDiv.className = 'd-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded';
                
                let seenHTML = '';
                if (window._showLprData !== false) {
                    let lastSeenText = 'Never detected';
                    const lastSeen = plateLastSeenMap[plate.credential];
                    if (lastSeen) {
                        const lastSeenDate = new Date(lastSeen);
                        lastSeenText = lastSeenDate.toLocaleDateString('en-US', { 
                            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        });
                    }
                    seenHTML = `<small class="text-muted ms-2">Last seen: ${lastSeenText}</small>`;
                }
                
                plateDiv.innerHTML = `
                    <div>
                        <span class="badge bg-secondary">${plate.credential}</span>
                        ${seenHTML}
                    </div>
                    <button type="button" class="btn btn-sm btn-danger" onclick="window.deletePlateFromModal('${visitor.id}', '${plate.credential}')">Delete</button>
                `;
                platesContainer.appendChild(plateDiv);
            });
        }
        
        console.log('Bootstrap available:', typeof bootstrap);
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            const modalElement = document.getElementById('editVisitorModal');
            console.log('Modal element found:', !!modalElement);
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
            console.log('Modal shown');
        } else {
            console.error('Bootstrap not available');
            alert('Modal system not ready. Please try again.');
        }
    } catch (error) {
        console.error('Error in openEditVisitorModal:', error);
        alert('Error: ' + error.message);
    }
};

window.deletePlateFromModal = async function(visitorId, plate) {
    if (!confirm(`Delete plate ${plate}?`)) return;
    
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.style.display = 'flex';
    try {
        const response = await fetch('/api/delete-visitor-plate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ visitorId, plate }),
        });
        if (response.ok) {
            const updatedResponse = await fetch(`/api/visitors/${visitorId}`);
            currentVisitor = await updatedResponse.json();
            
            // Fetch last seen data for plates
            let plateLastSeenMap = {};
            try {
                const lastSeenResponse = await fetch(`/api/visitor-last-seen/${visitorId}`);
                if (lastSeenResponse.ok) {
                    const data = await lastSeenResponse.json();
                    data.plateDetails.forEach(pd => {
                        plateLastSeenMap[pd.plate] = pd.lastSeen;
                    });
                }
            } catch (error) {
                console.error('Error fetching plate last seen:', error);
            }
            
            const visitor2 = currentVisitor.data || currentVisitor;
            const platesContainer = document.getElementById('editVisitorPlates');
            platesContainer.innerHTML = '';
            if (visitor2.license_plates && visitor2.license_plates.length > 0) {
                visitor2.license_plates.forEach(plate => {
                    const plateDiv = document.createElement('div');
                    plateDiv.className = 'd-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded';
                    
                    let seenHTML = '';
                    if (window._showLprData !== false) {
                        let lastSeenText = 'Never detected';
                        const lastSeen = plateLastSeenMap[plate.credential];
                        if (lastSeen) {
                            const lastSeenDate = new Date(lastSeen);
                            lastSeenText = lastSeenDate.toLocaleDateString('en-US', { 
                                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            });
                        }
                        seenHTML = `<small class="text-muted ms-2">Last seen: ${lastSeenText}</small>`;
                    }
                    
                    plateDiv.innerHTML = `
                        <div>
                            <span class="badge bg-secondary">${plate.credential}</span>
                            ${seenHTML}
                        </div>
                        <button type="button" class="btn btn-sm btn-danger" onclick="window.deletePlateFromModal('${visitor2.id}', '${plate.credential}')">Delete</button>
                    `;
                    platesContainer.appendChild(plateDiv);
                });
            }
        }
    } catch (error) {
        alert('Error deleting plate');
    } finally {
        loadingOverlay.style.display = 'none';
    }
};

window.renderSchedule = function(visitor) {
    const scheduleContainer = document.getElementById('scheduleContainer');
    scheduleContainer.innerHTML = '';
    
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const schedule = visitor.schedule?.weekly || {};
    
    days.forEach(day => {
        const dayTimes = schedule[day] || [];
        const startTime = dayTimes.length > 0 ? dayTimes[0].start_time : '08:00:00';
        const endTime = dayTimes.length > 0 ? dayTimes[0].end_time : '17:00:00';
        
        // Convert from HH:MM:SS to HH:MM format for HTML time input
        const startHM = startTime.substring(0, 5);
        const endHM = endTime.substring(0, 5);
        const isAllDay = dayTimes.length === 0 && (schedule[day + '_all_day'] || false);
        const noAccess = dayTimes.length === 0 && !isAllDay;
        
        const dayDiv = document.createElement('div');
        dayDiv.className = 'mb-2 p-2 border-bottom';
        dayDiv.innerHTML = `
            <div class="d-flex align-items-center gap-2">
                <div style="width: 100px; min-width: 100px;">
                    <label class="mb-0 fw-500">${day.charAt(0).toUpperCase() + day.slice(1)}</label>
                </div>
                <div style="width: 90px;">
                    <input type="time" class="form-control form-control-sm schedule-start-time" data-day="${day}" value="${startHM}">
                </div>
                <div style="width: 90px;">
                    <input type="time" class="form-control form-control-sm schedule-end-time" data-day="${day}" value="${endHM}">
                </div>
                <div class="form-check">
                    <input type="checkbox" class="form-check-input schedule-all-day" data-day="${day}" id="allDay-${day}" ${isAllDay ? 'checked' : ''}>
                    <label class="form-check-label" for="allDay-${day}">
                        <small>All Day</small>
                    </label>
                </div>
                <div class="form-check">
                    <input type="checkbox" class="form-check-input schedule-no-access" data-day="${day}" id="noAccess-${day}" ${noAccess ? 'checked' : ''}>
                    <label class="form-check-label" for="noAccess-${day}">
                        <small>No Access</small>
                    </label>
                </div>
            </div>
        `;
        scheduleContainer.appendChild(dayDiv);
    });
    
    // Add event listeners for all-day and no-access checkboxes
    document.querySelectorAll('.schedule-all-day').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const day = this.getAttribute('data-day');
            const noAccessCheckbox = document.querySelector(`.schedule-no-access[data-day="${day}"]`);
            const startInput = document.querySelector(`.schedule-start-time[data-day="${day}"]`);
            const endInput = document.querySelector(`.schedule-end-time[data-day="${day}"]`);
            
            // If All Day is checked, uncheck No Access
            if (this.checked) {
                noAccessCheckbox.checked = false;
                startInput.disabled = true;
                endInput.disabled = true;
                startInput.style.backgroundColor = '#e9ecef';
                endInput.style.backgroundColor = '#e9ecef';
                startInput.style.color = '#6c757d';
                endInput.style.color = '#6c757d';
            } else {
                // If All Day is unchecked and No Access isn't checked, enable time inputs
                if (!noAccessCheckbox.checked) {
                    startInput.disabled = false;
                    endInput.disabled = false;
                    startInput.style.backgroundColor = '';
                    endInput.style.backgroundColor = '';
                    startInput.style.color = '';
                    endInput.style.color = '';
                }
            }
        });
    });
    
    document.querySelectorAll('.schedule-no-access').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const day = this.getAttribute('data-day');
            const allDayCheckbox = document.querySelector(`.schedule-all-day[data-day="${day}"]`);
            const startInput = document.querySelector(`.schedule-start-time[data-day="${day}"]`);
            const endInput = document.querySelector(`.schedule-end-time[data-day="${day}"]`);
            
            // If No Access is checked, uncheck All Day
            if (this.checked) {
                allDayCheckbox.checked = false;
                startInput.disabled = true;
                endInput.disabled = true;
                startInput.style.backgroundColor = '#e9ecef';
                endInput.style.backgroundColor = '#e9ecef';
                startInput.style.color = '#6c757d';
                endInput.style.color = '#6c757d';
            } else {
                // If No Access is unchecked and All Day isn't checked, enable time inputs
                if (!allDayCheckbox.checked) {
                    startInput.disabled = false;
                    endInput.disabled = false;
                    startInput.style.backgroundColor = '';
                    endInput.style.backgroundColor = '';
                    startInput.style.color = '';
                    endInput.style.color = '';
                }
            }
        });
    });
    
    // Trigger initial state
    document.querySelectorAll('.schedule-all-day, .schedule-no-access').forEach(checkbox => {
        checkbox.dispatchEvent(new Event('change'));
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded event fired');
    // Determine whether showing LPR data is enabled (default: true)
    try {
        const siteResp = await fetch('/api/site-info');
        if (siteResp.ok) {
            const sitePayload = await siteResp.json();
            window._showLprData = sitePayload.showLprData !== false;
        } else {
            window._showLprData = true;
        }
    } catch (err) {
        window._showLprData = true;
    }
    const authContainer = document.getElementById('auth-container');
    const verifyContainer = document.getElementById('verify-container');
    const userDashboard = document.getElementById('user-dashboard');
    const sendCodeButton = document.getElementById('send-code');
    const verifyCodeButton = document.getElementById('verify-code');
    const logoutButton = document.getElementById('logout');
    const emailInput = document.getElementById('email');
    const codeInput = document.getElementById('code');
    const newPinInput = document.getElementById('new-pin');
    const changePinButton = document.getElementById('change-pin');
    const managedUserEmailSpan = document.getElementById('managed-user-email');
    const licensePlatesList = document.getElementById('license-plates-list');
    const newPlateInput = document.getElementById('new-plate');
    const addPlateButton = document.getElementById('add-plate');
    
    console.log('Send Code Button element:', sendCodeButton);
    console.log('Email input element:', emailInput);
    const loadingOverlay = document.getElementById('loading-overlay');
    const feedbackMessages = document.getElementById('feedback-messages');
    const pinError = document.getElementById('pin-error');
    const plateError = document.getElementById('plate-error');

    let currentUser = null;

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000; // 2 seconds

    function showLoading() {
        loadingOverlay.style.display = 'flex';
    }

    function hideLoading() {
        loadingOverlay.style.display = 'none';
    }

    function validatePin(pin) {
        if (pin.length < 5 || pin.length > 8) {
            return "PIN must be 5-8 digits long.";
        }
        if (/(.)\1{2,}/.test(pin)) {
            return "PIN cannot have repetitive numbers (e.g., 11111).";
        }
        for (let i = 0; i < pin.length - 2; i++) {
            if (
                parseInt(pin[i+1]) === parseInt(pin[i]) + 1 &&
                parseInt(pin[i+2]) === parseInt(pin[i+1]) + 1
            ) {
                return "PIN cannot contain sequential numbers (e.g., 12345).";
            }
        }
        return null;
    }

    function validatePlate(plate) {
        if (!plate || plate.length < 1) {
            return "License plate cannot be empty.";
        }
        return null;
    }

    function displayMessage(message, type = 'info') {
        feedbackMessages.innerHTML = ''; // Clear previous messages
        pinError.style.display = 'none';
        plateError.style.display = 'none';
        feedbackMessages.style.display = 'block';
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
        alertDiv.role = 'alert';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        feedbackMessages.appendChild(alertDiv);

        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.parentNode.removeChild(alertDiv);
            }
            if (feedbackMessages.children.length === 0) {
                feedbackMessages.style.display = 'none';
            }
        }, 5000); // Message disappears after 5 seconds
    }

    async function checkLogin(retryCount = 0, showErrors = true) {
        showLoading();
        try {
            const response = await fetch('/api/user');
                if (response.ok) {
                    try {
                        currentUser = await response.json();
                    } catch (parseErr) {
                        // Log raw response for debugging when JSON parse fails
                        const raw = await response.text();
                        console.error('Failed to parse /api/user JSON. Raw response:', raw);
                        throw parseErr;
                    }
                authContainer.style.display = 'none';
                userDashboard.style.display = 'block';
                
                // Show navbar elements for logged in user
                const logoutBtn = document.getElementById('logoutBtn');
                if (logoutBtn) logoutBtn.style.display = 'block';

                await getManagedUsers(currentUser.email);
                await getLicensePlates(currentUser.email);
                await displayUserProfile(currentUser.email);

                // Ensure LPR tiles load after login (in case user logged in after window load)
                try {
                    if (typeof window.loadLprTiles === 'function') {
                        window.loadLprTiles();
                    }
                } catch (e) {
                    console.debug('loadLprTiles not available yet:', e.message);
                }

                // After all data is fetched and rendered, make the user-info-display visible
                const userInfoDisplay = document.getElementById('user-info-display');
                if (userInfoDisplay) userInfoDisplay.style.display = 'block';

            } else {
                // Check for 404 specifically, which indicates user not found in cache
                if (response.status === 404 && retryCount < MAX_RETRIES) {
                    console.warn(`User not found on attempt ${retryCount + 1}. Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
                    setTimeout(() => checkLogin(retryCount + 1, showErrors), RETRY_DELAY_MS);
                } else {
                    // If not 404 or max retries reached, show auth container
                    authContainer.style.display = 'block';
                    userDashboard.style.display = 'none';
                    
                    // Hide navbar elements for logged out user
                    const logoutBtn = document.getElementById('logoutBtn');
                    if (logoutBtn) logoutBtn.style.display = 'none';
                    
                    // Only show errors if explicitly requested (not on initial page load)
                    if (showErrors && response.status !== 404) {
                        console.error(`API error: ${response.status}`);
                        displayMessage('Login failed. Please try again.', 'danger');
                    } else if (showErrors && retryCount >= MAX_RETRIES) {
                        console.error(`Max retries reached for user not found`);
                        displayMessage('User profile not found. Please contact support.', 'danger');
                    }
                }
            }
        } catch (error) {
            console.error('Error checking login status:', error);
            authContainer.style.display = 'block';
            userDashboard.style.display = 'none';
            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) logoutBtn.style.display = 'none';
            // Only show error if explicitly requested
            if (showErrors) {
                displayMessage('An error occurred. Please try again.', 'danger');
            }
        } finally {
            hideLoading();
        }
    }

    async function displayUserProfile(email) {
        try {
            const response = await fetch('/api/user/profile');
            if (response.ok) {
                const profile = await response.json();
                
                // Set user name
                document.getElementById('user-name').textContent = profile.name;
                
                // Display avatar - use personal avatar if available, otherwise use default.png
                const avatarContainer = document.getElementById('user-avatar-container');
                const avatarImg = document.getElementById('user-avatar');
                
                if (profile.avatar && profile.avatar.trim()) {
                    // User has an avatar, try to load it
                    avatarImg.src = profile.avatar;
                    // Add error handler to fall back to default if image fails to load
                    avatarImg.onerror = function() {
                        this.src = '/avatars/default.png';
                        avatarContainer.style.display = 'block';
                    };
                    avatarContainer.style.display = 'block';
                } else {
                    // No avatar, use default
                    avatarImg.src = '/avatars/default.png';
                    avatarContainer.style.display = 'block';
                }
                
                // Display address if available, clean up formatting
                if (profile.address) {
                    const addressElement = document.getElementById('user-address');
                    // Clean up address: remove trailing periods and extra whitespace
                    const cleanAddress = profile.address.replace(/\.+$/, '').trim();
                    addressElement.textContent = cleanAddress;
                    addressElement.style.display = 'block';
                }
            }
        } catch (err) {
            console.error('Error fetching user profile:', err);
        }
    }

    async function getManagedUsers(email) {
        showLoading();
        try {
            const response = await fetch('/api/user/name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });
            const name = await response.text();
            managedUserEmailSpan.textContent = email; // Display the user's email
        } finally {
            hideLoading();
        }
    }



    function displayLicensePlates(plates, selectedUserEmail) {
        const licensePlatesList = document.getElementById('license-plates-list');
        licensePlatesList.innerHTML = '';
        
        if (!plates || plates.length === 0) {
            licensePlatesList.innerHTML = '<p class="text-muted">No license plates added yet.</p>';
            return;
        }
        
        const showLpr = window._showLprData !== false;

        // Create table
        const table = document.createElement('table');
        table.className = 'table table-sm';
        table.style.marginTop = '15px';
        table.style.marginBottom = '15px';
        
        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headerRow.style.borderBottom = '2px solid #ccc';
        
        const headers = showLpr ? ['Plate', 'Last Seen', '24h Detections', '7-Day Detections', '30-Day Detections', 'Action'] : ['Plate', 'Action'];
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.style.padding = '10px 5px';
            th.style.fontWeight = '600';
            th.style.fontSize = '13px';
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body
        const tbody = document.createElement('tbody');
        
        plates.forEach(plate => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #ddd';
            
            // Plate column
            const plateCell = document.createElement('td');
            plateCell.textContent = plate.plate;
            plateCell.style.padding = '8px 5px';
            plateCell.style.fontWeight = '500';
            row.appendChild(plateCell);
            
            let lastSeenCell, count24hCell, count7dCell, count30dCell;
            if (showLpr) {
                // Last Seen column
                lastSeenCell = document.createElement('td');
                lastSeenCell.textContent = 'Loading...';
                lastSeenCell.style.padding = '8px 5px';
                lastSeenCell.style.fontSize = '12px';
                lastSeenCell.style.color = '#666';
                row.appendChild(lastSeenCell);
                
                // 24h Detections column
                count24hCell = document.createElement('td');
                count24hCell.textContent = 'Loading...';
                count24hCell.style.padding = '8px 5px';
                count24hCell.style.fontSize = '12px';
                count24hCell.style.textAlign = 'center';
                row.appendChild(count24hCell);
                
                // 7-Day Detections column
                count7dCell = document.createElement('td');
                count7dCell.textContent = 'Loading...';
                count7dCell.style.padding = '8px 5px';
                count7dCell.style.fontSize = '12px';
                count7dCell.style.textAlign = 'center';
                row.appendChild(count7dCell);
                
                // 30-Day Detections column
                count30dCell = document.createElement('td');
                count30dCell.textContent = 'Loading...';
                count30dCell.style.padding = '8px 5px';
                count30dCell.style.fontSize = '12px';
                count30dCell.style.textAlign = 'center';
                row.appendChild(count30dCell);
            }
            
            // Action column
            const actionCell = document.createElement('td');
            actionCell.style.padding = '8px 5px';
            const removeButton = document.createElement('button');
            removeButton.className = 'btn btn-danger btn-sm';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', async () => {
                showLoading();
                try {
                    await fetch('/remove-license-plate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ email: selectedUserEmail, plate: plate.plate }),
                    });
                    await getLicensePlates(selectedUserEmail);
                } finally {
                    hideLoading();
                }
            });
            actionCell.appendChild(removeButton);
            row.appendChild(actionCell);
            
            tbody.appendChild(row);
            
            if (!showLpr) return; // Skip fetching LPR counts/last-seen when disabled
            
            // Fetch last seen
            fetch(`/api/license-plate-last-seen/${plate.plate}`)
                .then(response => response.ok ? response.json() : null)
                .then(data => {
                    if (data && data.lastSeen) {
                        const lastSeenDate = new Date(data.lastSeen);
                        const formattedDate = lastSeenDate.toLocaleDateString('en-US', { 
                            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        });
                        lastSeenCell.textContent = formattedDate;
                    } else {
                        lastSeenCell.textContent = 'Never';
                    }
                })
                .catch(error => {
                    console.error('Error fetching last seen:', error);
                    lastSeenCell.textContent = 'Unknown';
                });
            
            // Fetch 24h count
            fetch(`/api/license-plate-24hour-count/${plate.plate}`)
                .then(response => response.ok ? response.json() : null)
                .then(data => {
                    count24hCell.textContent = data ? data.count : '0';
                })
                .catch(error => {
                    console.error('Error fetching 24h count:', error);
                    count24hCell.textContent = 'Unknown';
                });
            
            // Fetch 7-day count
            fetch(`/api/license-plate-7day-count/${plate.plate}`)
                .then(response => response.ok ? response.json() : null)
                .then(data => {
                    count7dCell.textContent = data ? data.count : '0';
                })
                .catch(error => {
                    console.error('Error fetching 7-day count:', error);
                    count7dCell.textContent = 'Unknown';
                });
            
            // Fetch 30-day count
            fetch(`/api/license-plate-30day-count/${plate.plate}`)
                .then(response => response.ok ? response.json() : null)
                .then(data => {
                    count30dCell.textContent = data ? data.count : '0';
                })
                .catch(error => {
                    console.error('Error fetching 30-day count:', error);
                    count30dCell.textContent = 'Unknown';
                });
        });
        
        table.appendChild(tbody);
        licensePlatesList.appendChild(table);
    }

    function createLicensePlateListItem(plate, selectedUserEmail) {
        // This function is deprecated - use displayLicensePlates() instead
        return document.createElement('li');
    }

    async function getLicensePlates(email) {
        showLoading();
        try {
            const response = await fetch('/get-license-plates', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });
            const plates = await response.json();
            displayLicensePlates(plates, email);
        } finally {
            hideLoading();
        }
    }

    sendCodeButton.addEventListener('click', async () => {
        console.log('Send Code button clicked');
        const email = emailInput.value;
        console.log('Email value:', email);
        if (email) {
            showLoading();
            sendCodeButton.setAttribute('data-original-text', sendCodeButton.textContent);
            sendCodeButton.textContent = 'Sending...';
            sendCodeButton.disabled = true;
            try {
                console.log('Sending request to /send-code');
                const response = await fetch('/send-code', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email }),
                });
                const data = await response.json();
                console.log('Response:', response.status, data);
                if (!response.ok) {
                    displayMessage(data.error || 'Failed to send verification code. Please try again.', 'danger');
                } else {
                    authContainer.style.display = 'none';
                    verifyContainer.style.display = 'block';
                    displayMessage('Verification code sent to your email.', 'success');
                }
            } catch (error) {
                console.error('Error sending code:', error);
                displayMessage('Failed to send verification code. Please try again.', 'danger');
            } finally {
                hideLoading();
                sendCodeButton.textContent = sendCodeButton.getAttribute('data-original-text');
                sendCodeButton.disabled = false;
            }
        } else {
            displayMessage('Please enter your email.', 'warning');
        }
    });

    verifyCodeButton.addEventListener('click', async () => {
        const email = emailInput.value;
        const code = codeInput.value;
        if (!code) {
            displayMessage('Please enter the verification code', 'danger');
            return;
        }
        if (!email) {
            displayMessage('Please enter your email', 'danger');
            return;
        }
        
        showLoading();
        verifyCodeButton.setAttribute('data-original-text', verifyCodeButton.textContent);
        verifyCodeButton.textContent = 'Verifying...';
        verifyCodeButton.disabled = true;
        try {
            const response = await fetch('/verify-code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, code }),
            });
            if (response.ok) {
                const data = await response.json();
                verifyContainer.style.display = 'none';
                await checkLogin();
                // Reinitialize header to show navbar
                if (typeof reinitializeHeader === 'function') {
                    reinitializeHeader();
                }
                displayMessage('Login successful!', 'success');
            } else {
                let errorText = 'Invalid code';
                try {
                    const errorData = await response.json();
                    errorText = errorData.error || errorText;
                } catch {
                    // Fallback if response is not JSON
                    errorText = await response.text();
                }
                displayMessage(errorText, 'danger');
                console.error(`Verification failed: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error('Error verifying code:', error);
            displayMessage('An error occurred during verification. Please try again.', 'danger');
        } finally {
            hideLoading();
            verifyCodeButton.textContent = verifyCodeButton.getAttribute('data-original-text');
            verifyCodeButton.disabled = false;
        }
    });

    if (changePinButton) {
        changePinButton.addEventListener('click', async () => {
            const selectedUserEmail = currentUser.email;
            const newPin = newPinInput.value;
            const pinErrorMessage = validatePin(newPin);

            if (pinErrorMessage) {
                pinError.textContent = pinErrorMessage;
                pinError.style.display = 'block';
                return;
            } else {
                pinError.style.display = 'none';
            }

            if (newPin) {
                showLoading();
                changePinButton.setAttribute('data-original-text', changePinButton.textContent);
                changePinButton.textContent = 'Changing PIN...';
                changePinButton.disabled = true;
                try {
                    const response = await fetch('/change-pin', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ email: selectedUserEmail, newPin }),
                    });
                    if (response.ok) {
                        displayMessage('PIN changed successfully', 'success');
                        newPinInput.value = '';
                    } else {
                        displayMessage('Error changing PIN', 'danger');
                    }
                } catch (error) {
                    console.error('Error changing PIN:', error);
                    displayMessage('An error occurred while changing PIN. Please try again.', 'danger');
                } finally {
                    hideLoading();
                    changePinButton.textContent = changePinButton.getAttribute('data-original-text');
                    changePinButton.disabled = false;
                }
            }
        });
    }

    addPlateButton.addEventListener('click', async () => {
        const selectedUserEmail = currentUser.email;
        const newPlate = newPlateInput.value;
        const plateErrorMessage = validatePlate(newPlate);

        if (plateErrorMessage) {
            plateError.textContent = plateErrorMessage;
            plateError.style.display = 'block';
            return;
        } else {
            plateError.style.display = 'none';
        }

        if (newPlate) {
            showLoading();
            addPlateButton.setAttribute('data-original-text', addPlateButton.textContent);
            addPlateButton.textContent = 'Adding Plate...';
            addPlateButton.disabled = true;
            try {
                const response = await fetch('/add-license-plate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: selectedUserEmail, plate: newPlate }),
                });
                const data = await response.json();
                console.log('Add plate response status:', response.status, 'ok:', response.ok, 'data:', data);
                if (!response.ok) {
                    displayMessage(data.error || 'Failed to add license plate. Please try again.', 'danger');
                } else {
                    // Wait a moment for the API to fully sync the data
                    await new Promise(resolve => setTimeout(resolve, 800));
                    await getLicensePlates(selectedUserEmail);
                    newPlateInput.value = '';
                    displayMessage('License plate added successfully.', 'success');
                }
            } catch (error) {
                console.error('Error adding plate:', error);
                displayMessage('Failed to add license plate. Please try again.', 'danger');
            } finally {
                hideLoading();
                addPlateButton.textContent = addPlateButton.getAttribute('data-original-text');
                addPlateButton.disabled = false;
            }
        }
    });

    const sendInviteButton = document.getElementById('send-invite-button');
    if (sendInviteButton) {
        sendInviteButton.addEventListener('click', async () => {
            if (!currentUser || !currentUser.email) {
                displayMessage('User email not available. Please log in again.', 'danger');
                return;
            }
            showLoading();
            sendInviteButton.setAttribute('data-original-text', sendInviteButton.textContent);
            sendInviteButton.textContent = 'Sending Invite...';
            sendInviteButton.disabled = true;
            try {
                const emailToInvite = currentUser.email; // Use logged-in user's email directly
                const response = await fetch('/api/send-invite', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: emailToInvite }),
                });

                if (response.ok) {
                    displayMessage(`Invitation sent successfully to your email (${emailToInvite}) for SMB Gate!`, 'success');
                } else {
                    const errorText = await response.text();
                    displayMessage(`Failed to send invitation to your email (${emailToInvite}) for SMB Gate: ${errorText}`, 'danger');
                }
            } catch (error) {
                console.error('Error sending invitation to SMB Gate:', error);
                displayMessage('An error occurred while trying to send the invitation to SMB Gate.', 'danger');
            } finally {
                hideLoading();
                sendInviteButton.textContent = sendInviteButton.getAttribute('data-original-text');
                sendInviteButton.disabled = false;
            }
        });
    }

    const sendInviteSite2Button = document.getElementById('send-invite-site2-button');
    if (sendInviteSite2Button) {
        sendInviteSite2Button.addEventListener('click', async () => {
            if (!currentUser || !currentUser.email) {
                displayMessage('User email not available. Please log in again.', 'danger');
                return;
            }
            showLoading();
            sendInviteSite2Button.setAttribute('data-original-text', sendInviteSite2Button.textContent);
            sendInviteSite2Button.textContent = 'Sending Invite...';
            sendInviteSite2Button.disabled = true;
            try {
                const emailToInvite = currentUser.email; // Use logged-in user's email directly
                const response = await fetch('/api/send-invite-site2', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ email: emailToInvite }),
                });

                if (response.ok) {
                    displayMessage(`Invitation sent successfully to your email (${emailToInvite}) for Clubhouse/Pool!`, 'success');
                } else {
                    const errorText = await response.text();
                    displayMessage(`Failed to send invitation to your email (${emailToInvite}) for Clubhouse/Pool: ${errorText}`, 'danger');
                }
            } catch (error) {
                console.error('Error sending invitation to Clubhouse/Pool:', error);
                displayMessage('An error occurred while trying to send the invitation to Clubhouse/Pool.', 'danger');
            }
            finally {
                hideLoading();
                sendInviteSite2Button.textContent = sendInviteSite2Button.getAttribute('data-original-text');
                sendInviteSite2Button.disabled = false;
            }
        });
    }

    // Visitor Management Functions
    async function getVisitors() {
        try {
            const response = await fetch('/api/visitors', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch visitors');
            }
            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error('Error fetching visitors:', error);
            displayMessage('Failed to fetch visitors. Please try again.', 'danger');
            return [];
        }
    }

    function createVisitorTableRow(visitor) {
        const row = document.createElement('tr');
        
        // Create combined Name + Expiration cell
        const nameExpirationCell = document.createElement('td');
        nameExpirationCell.colSpan = '3';
        
        let visitorName = 'Unknown';
        if (visitor.first_name && visitor.last_name) {
            visitorName = `${visitor.first_name} ${visitor.last_name}`;
        } else if (visitor.first_name) {
            visitorName = visitor.first_name;
        } else if (visitor.last_name) {
            visitorName = visitor.last_name;
        }
        
        let expirationText = 'N/A';
        if (visitor.end_time) {
            const expirationDate = new Date(visitor.end_time * 1000);
            expirationText = expirationDate.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
            });
        }
        
        nameExpirationCell.innerHTML = `<strong>${visitorName}</strong> <span class="text-muted">(Expires: ${expirationText})</span>`;
        row.appendChild(nameExpirationCell);
        
        return row;
    }

    function createPlateRow(visitor, plate) {
        const row = document.createElement('tr');
        
        // Plate Cell (indented, with larger left padding)
        const plateCell = document.createElement('td');
        plateCell.className = 'ps-4';
        const plateTag = document.createElement('span');
        plateTag.className = 'badge bg-secondary';
        plateTag.textContent = plate.credential;
        plateCell.appendChild(plateTag);
        row.appendChild(plateCell);
        
        // Empty cells to align with header
        const emptyCell1 = document.createElement('td');
        row.appendChild(emptyCell1);
        const emptyCell2 = document.createElement('td');
        row.appendChild(emptyCell2);
        
        // Actions Cell
        const actionsCell = document.createElement('td');
        
        const deletePlateBtn = document.createElement('button');
        deletePlateBtn.className = 'btn btn-sm btn-danger';
        deletePlateBtn.textContent = 'Delete';
        deletePlateBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Are you sure you want to delete plate ${plate.credential}?`)) {
                showLoading();
                try {
                    const response = await fetch('/api/delete-visitor-plate', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ visitorId: visitor.id, plate: plate.credential }),
                    });
                    if (response.ok) {
                        displayMessage(`Plate ${plate.credential} deleted`, 'success');
                        await displayVisitors();
                    } else {
                        const errorText = await response.text();
                        displayMessage(`Failed to delete plate: ${errorText}`, 'danger');
                    }
                } catch (error) {
                    console.error('Error deleting plate:', error);
                    displayMessage('Failed to delete plate. Please try again.', 'danger');
                } finally {
                    hideLoading();
                }
            }
        });
        
        actionsCell.appendChild(deletePlateBtn);
        row.appendChild(actionsCell);
        
        return row;
    }

    
    // Visitor caching
    let visitorCache = null;
    let visitorCacheTime = null;
    const VISITOR_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
    let visitorRefreshInterval = null;

    // Background refresh of visitors every 2 minutes
    async function startVisitorBackgroundRefresh() {
        if (visitorRefreshInterval) {
            clearInterval(visitorRefreshInterval);
        }
        
        visitorRefreshInterval = setInterval(async () => {
            console.log('Background visitor refresh...');
            try {
                const freshVisitors = await getVisitors();
                visitorCache = freshVisitors;
                visitorCacheTime = Date.now();
                lastSeenCache = {}; // Clear last-seen cache on refresh
                console.log('Background visitor refresh complete');
            } catch (error) {
                console.error('Background visitor refresh failed:', error);
            }
        }, 2 * 60 * 1000); // Every 2 minutes
    }

    async function displayVisitors(forceRefresh = false) {
        const visitorsList = document.getElementById('visitors-list');
        const visitorsEmpty = document.getElementById('visitors-empty');
        
        showLoading();
        visitorsList.innerHTML = '';
        visitorsEmpty.style.display = 'none';
        
        let visitors = null;
        const now = Date.now();
        
        // Use cache if available and not force refreshing
        if (!forceRefresh && visitorCache && visitorCacheTime && (now - visitorCacheTime) < VISITOR_CACHE_DURATION) {
            console.log('Using cached visitor data');
            visitors = visitorCache;
        } else {
            console.log('Fetching fresh visitor data');
            visitors = await getVisitors();
            visitorCache = visitors;
            visitorCacheTime = now;
            lastSeenCache = {}; // Clear last-seen cache on refresh
        }
        
        if (visitors.length === 0) {
            visitorsEmpty.style.display = 'block';
            hideLoading();
        } else {
            const container = document.createElement('div');
            container.className = 'row g-3';
            
            // Render all cards immediately without waiting for last-seen data
            for (const visitor of visitors) {
                const card = createVisitorCardSync(visitor);
                container.appendChild(card);
            }
            
            visitorsList.appendChild(container);
            hideLoading();
        }
        
        // Start background refresh if not already running
        if (!visitorRefreshInterval) {
            startVisitorBackgroundRefresh();
        }
    }

    // Synchronous version of card creation (no async calls)
    function createVisitorCardSync(visitor) {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4';
        
        let visitorName = 'Unknown';
        if (visitor.first_name && visitor.last_name) {
            visitorName = `${visitor.first_name} ${visitor.last_name}`;
        } else if (visitor.first_name) {
            visitorName = visitor.first_name;
        } else if (visitor.last_name) {
            visitorName = visitor.last_name;
        }
        
        const createdDate = new Date(visitor.create_time * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        const startDate = new Date(visitor.start_time * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        const endDate = new Date(visitor.end_time * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        // Get cached last seen or show no data
        let lastSeenHTML = '<span class="text-muted">No data</span>';
        if (lastSeenCache[visitor.id]) {
            const data = lastSeenCache[visitor.id];
            if (data.lastSeen) {
                const lastSeenDate = new Date(data.lastSeen);
                const formattedDate = lastSeenDate.toLocaleDateString('en-US', { 
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                lastSeenHTML = `<strong>${formattedDate}</strong>`;
            } else {
                lastSeenHTML = '<span class="text-muted">No detections</span>';
            }
        }
        
        const card = document.createElement('div');
        card.className = 'card h-100 cursor-pointer';
        card.style.cursor = 'pointer';
        card.id = `visitor-card-${visitor.id}`;
        
        let platesHTML = '';
        if (visitor.license_plates && visitor.license_plates.length > 0) {
            platesHTML = visitor.license_plates.map(p => 
                `<span class="badge bg-secondary me-1 mb-1">${p.credential}</span>`
            ).join('');
        } else {
            platesHTML = '<span class="text-muted">No plates</span>';
        }
        
        const status = visitor.status ? visitor.status.toLowerCase() : 'unknown';
        let statusBadgeClass = 'bg-secondary';
        if (status === 'active') statusBadgeClass = 'bg-success';
        else if (status === 'upcoming') statusBadgeClass = 'bg-info';
        else if (status === 'expired') statusBadgeClass = 'bg-danger';
        
        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <h5 class="card-title mb-0">${visitorName}</h5>
                    <span class="badge ${statusBadgeClass}">${visitor.status}</span>
                </div>
                <p class="card-text text-muted small mb-2">Created: ${createdDate}</p>
                <div class="mb-3">
                    <small class="text-muted d-block">Access: ${startDate} to ${endDate}</small>
                </div>
                <div class="mb-3">
                    <small class="text-muted d-block"><strong>Last Seen:</strong> ${lastSeenHTML}</small>
                </div>
                <div class="mb-3">
                    <small><strong>License Plates:</strong></small>
                    <div>${platesHTML}</div>
                </div>
            </div>
        `;
        
        card.addEventListener('click', () => openEditVisitorModal(visitor.id));
        
        col.appendChild(card);
        return col;
    }

    
    window.refreshVisitorsList = async function() {
        await displayVisitors(true);
    };
    
    async function createVisitorCard(visitor) {
        const col = document.createElement('div');
        col.className = 'col-md-6 col-lg-4';
        
        let visitorName = 'Unknown';
        if (visitor.first_name && visitor.last_name) {
            visitorName = `${visitor.first_name} ${visitor.last_name}`;
        } else if (visitor.first_name) {
            visitorName = visitor.first_name;
        } else if (visitor.last_name) {
            visitorName = visitor.last_name;
        }
        
        const createdDate = new Date(visitor.create_time * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        const startDate = new Date(visitor.start_time * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        const endDate = new Date(visitor.end_time * 1000).toLocaleDateString('en-US', { 
            year: 'numeric', month: 'short', day: 'numeric' 
        });
        
        // Fetch last seen date for this visitor (with cache)
        let lastSeenHTML = '<span class="text-muted">No detections</span>';
        try {
            if (lastSeenCache[visitor.id]) {
                const data = lastSeenCache[visitor.id];
                if (data.lastSeen) {
                    const lastSeenDate = new Date(data.lastSeen);
                    const formattedDate = lastSeenDate.toLocaleDateString('en-US', { 
                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                    lastSeenHTML = `<strong>${formattedDate}</strong>`;
                }
            } else {
                const response = await fetch(`/api/visitor-last-seen/${visitor.id}`);
                if (response.ok) {
                    const data = await response.json();
                    lastSeenCache[visitor.id] = data;
                    if (data.lastSeen) {
                        const lastSeenDate = new Date(data.lastSeen);
                        const formattedDate = lastSeenDate.toLocaleDateString('en-US', { 
                            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        });
                        lastSeenHTML = `<strong>${formattedDate}</strong>`;
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching last seen:', error);
        }
        
        const card = document.createElement('div');
        card.className = 'card h-100 cursor-pointer';
        card.style.cursor = 'pointer';
        
        let platesHTML = '';
        if (visitor.license_plates && visitor.license_plates.length > 0) {
            platesHTML = visitor.license_plates.map(p => 
                `<span class="badge bg-secondary me-1 mb-1">${p.credential}</span>`
            ).join('');
        } else {
            platesHTML = '<span class="text-muted">No plates</span>';
        }
        
        const status = visitor.status ? visitor.status.toLowerCase() : 'unknown';
        let statusBadgeClass = 'bg-secondary';
        if (status === 'active') statusBadgeClass = 'bg-success';
        else if (status === 'upcoming') statusBadgeClass = 'bg-info';
        else if (status === 'expired') statusBadgeClass = 'bg-danger';
        
        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <h5 class="card-title mb-0">${visitorName}</h5>
                    <span class="badge ${statusBadgeClass}">${visitor.status}</span>
                </div>
                <p class="card-text text-muted small mb-2">Created: ${createdDate}</p>
                <div class="mb-3">
                    <small class="text-muted d-block">Access: ${startDate} to ${endDate}</small>
                </div>
                <div class="mb-3">
                    <small class="d-block mb-1"><strong>License Plates:</strong></small>
                    <div>${platesHTML}</div>
                </div>
                <div class="mb-3">
                    <small class="d-block mb-1"><strong>Last Seen:</strong></small>
                    ${lastSeenHTML}
                </div>
                ${visitor.remarks ? `<p class="card-text small mb-2"><strong>Remarks:</strong> ${visitor.remarks}</p>` : ''}
                <small class="text-muted">${visitor.email || 'No email'}</small>
            </div>
            <div class="card-footer bg-transparent">
                <button class="btn btn-sm btn-primary w-100" onclick="window.openEditVisitorModal('${visitor.id}')">Edit Visitor</button>
            </div>
        `;
        
        col.appendChild(card);
        return col;
    }
    
    document.getElementById('saveVisitorBtn').addEventListener('click', async () => {
        if (!currentVisitor) return;
        
        const visitor = currentVisitor.data || currentVisitor;
        const firstName = document.getElementById('editFirstName').value.trim();
        const lastName = document.getElementById('editLastName').value.trim();
        const startDate = document.getElementById('editStartDate').value;
        const endDate = document.getElementById('editEndDate').value;
        const remarks = document.getElementById('editRemarks').value;
        
        if (!firstName || !lastName) {
            displayMessage('First and last names are required', 'warning');
            return;
        }
        
        if (!startDate || !endDate) {
            displayMessage('Start and end dates are required', 'warning');
            return;
        }
        
        const startTime = Math.floor(new Date(startDate).getTime() / 1000);
        const endTime = Math.floor(new Date(endDate).getTime() / 1000);
        
        // Build schedule object from form inputs
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const weekly = {};
        
        days.forEach(day => {
            const isAllDay = document.querySelector(`.schedule-all-day[data-day="${day}"]`)?.checked || false;
            const noAccess = document.querySelector(`.schedule-no-access[data-day="${day}"]`)?.checked || false;
            
            if (noAccess) {
                weekly[day] = []; // Empty array means no access
            } else if (isAllDay) {
                weekly[day] = [{ // All day access
                    start_time: '00:00:00',
                    end_time: '23:59:59'
                }];
            } else {
                const startTimeInput = document.querySelector(`.schedule-start-time[data-day="${day}"]`)?.value || '08:00';
                const endTimeInput = document.querySelector(`.schedule-end-time[data-day="${day}"]`)?.value || '17:00';
                weekly[day] = [{
                    start_time: startTimeInput + ':00',
                    end_time: endTimeInput + ':00'
                }];
            }
        });
        
        showLoading();
        try {
            const response = await fetch('/api/update-visitor', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    visitorId: visitor.id,
                    update: {
                        first_name: firstName,
                        last_name: lastName,
                        remarks: remarks,
                        start_time: startTime,
                        end_time: endTime,
                        schedule: { weekly: weekly }
                    }
                })
            });

            if (response.ok) {
                displayMessage('Visitor updated successfully', 'success');
                bootstrap.Modal.getInstance(document.getElementById('editVisitorModal')).hide();
                await displayVisitors();
            } else {
                const err = await response.json().catch(() => ({}));
                console.error('Update visitor failed:', err);
                displayMessage('Failed to update visitor', 'danger');
            }
        } catch (error) {
            console.error('Error saving visitor:', error);
            displayMessage('Error updating visitor', 'danger');
        } finally {
            hideLoading();
        }
    });
    
    document.getElementById('deleteVisitorBtn').addEventListener('click', async () => {
        if (!currentVisitor) return;
        if (!confirm('Are you sure you want to delete this visitor?')) return;
        
        const visitor = currentVisitor.data || currentVisitor;
        showLoading();
        try {
            const response = await fetch('/api/delete-visitor', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ visitorId: visitor.id }),
            });
            if (response.ok) {
                displayMessage('Visitor deleted successfully', 'success');
                bootstrap.Modal.getInstance(document.getElementById('editVisitorModal')).hide();
                await displayVisitors();
            } else {
                displayMessage('Failed to delete visitor', 'danger');
            }
        } catch (error) {
            console.error('Error deleting visitor:', error);
            displayMessage('Error deleting visitor', 'danger');
        } finally {
            hideLoading();
        }
    });
    
    document.getElementById('addPlateModalBtn').addEventListener('click', async () => {
        if (!currentVisitor) return;
        const visitor = currentVisitor.data || currentVisitor;
        const newPlate = document.getElementById('newPlateInput').value.trim();
        
        if (!newPlate) {
            displayMessage('Please enter a license plate', 'warning');
            return;
        }
        
        showLoading();
        try {
            const response = await fetch('/api/add-visitor-plate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ visitorId: visitor.id, plate: newPlate }),
            });
            if (response.ok) {
                displayMessage('Plate added successfully', 'success');
                document.getElementById('newPlateInput').value = '';
                const updatedResponse = await fetch(`/api/visitors/${visitor.id}`);
                currentVisitor = await updatedResponse.json();
                
                const visitor2 = currentVisitor.data || currentVisitor;
                
                // Fetch last seen data for plates
                let plateLastSeenMap = {};
                try {
                    const lastSeenResponse = await fetch(`/api/visitor-last-seen/${visitor2.id}`);
                    if (lastSeenResponse.ok) {
                        const data = await lastSeenResponse.json();
                        data.plateDetails.forEach(pd => {
                            plateLastSeenMap[pd.plate] = pd.lastSeen;
                        });
                    }
                } catch (error) {
                    console.error('Error fetching plate last seen:', error);
                }
                
                const platesContainer = document.getElementById('editVisitorPlates');
                platesContainer.innerHTML = '';
                if (visitor2.license_plates && visitor2.license_plates.length > 0) {
                    visitor2.license_plates.forEach(plate => {
                        const plateDiv = document.createElement('div');
                        plateDiv.className = 'd-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded';
                        
                        let lastSeenText = 'Never detected';
                        const lastSeen = plateLastSeenMap[plate.credential];
                        if (lastSeen) {
                            const lastSeenDate = new Date(lastSeen);
                            lastSeenText = lastSeenDate.toLocaleDateString('en-US', { 
                                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                            });
                        }
                        
                        plateDiv.innerHTML = `
                            <div>
                                <span class="badge bg-secondary">${plate.credential}</span>
                                <small class="text-muted ms-2">Last seen: ${lastSeenText}</small>
                            </div>
                            <button type="button" class="btn btn-sm btn-danger" onclick="window.deletePlateFromModal('${visitor2.id}', '${plate.credential}')">Delete</button>
                        `;
                        platesContainer.appendChild(plateDiv);
                    });
                }
            } else {
                const errorData = await response.json().catch(() => ({}));
                displayMessage(errorData.error || 'Failed to add plate', 'danger');
            }
        } catch (error) {
            console.error('Error adding plate:', error);
            displayMessage('Error adding plate', 'danger');
        } finally {
            hideLoading();
        }
    });

    // Load visitors when Visitors tab is clicked
    const visitorsTab = document.getElementById('visitors-tab');
    if (visitorsTab) {
        visitorsTab.addEventListener('shown.bs.tab', async () => {
            await displayVisitors();
        });
    }

    logoutButton.addEventListener('click', async () => {
        try {
            // Call logout endpoint which destroys session and redirects
            window.location.href = '/logout';
        } catch (error) {
            console.error('Logout error:', error);
        }
    });

    // Handle logout from navbar
    const logoutLink = document.getElementById('logoutLink');
    if (logoutLink) {
        logoutLink.addEventListener('click', async () => {
            try {
                window.location.href = '/logout';
            } catch (error) {
                console.error('Logout error:', error);
            }
        });
    }

    // Check login status on page load, but don't show errors yet (user hasn't tried to log in)
    await checkLogin(0, false);
});
