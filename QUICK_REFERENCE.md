# Quick Reference - Admin Dashboard & Security Features

## 🎯 Quick Start

### Accessing Admin Dashboard
1. Log in with email: `admin@example.com` (or add to ADMIN_EMAILS)
2. Click "Admin Dashboard" link in navbar
3. View real-time metrics and security data

### Enabling Dark Mode
1. Click "🌙 Dark Mode" toggle in navbar
2. Preference saved automatically
3. Persists across sessions

---

## 📊 Dashboard Sections

### Main Metrics (24-hour snapshot)
- API Requests count
- Average Response Time
- Failed Requests & Failure Rate
- Failed Login Attempts
- Visitor Modifications

### System Status
- Database: CONNECTED/DISCONNECTED
- API: OPERATIONAL/NO DATA
- Security: NORMAL/ALERT
- Active issues list

### API Health & Performance
**Tabs:**
- Health Overview → Bar chart of endpoint success rates
- Endpoint Stats → Table of all endpoints with metrics
- Trends → Line chart of hourly error rates

**Metrics:**
- Request count per endpoint
- Success/failure rates
- Response time ranges
- Recent errors

### Security & Failed Logins
**Tabs:**
- Summary → Overview metrics
- Anomalies → Email and IP threat detection
- Timeline → Time-based attack pattern detection

**Anomaly Flags:**
- 🟡 Email: 3+ attempts OR 3+ different IPs
- 🔴 IP: 5+ attempts OR 3+ target emails
- ⚠️ Spike: 5+ attempts in 5-minute window

### Performance Analytics
- Request count distribution
- Latency percentiles (p50, p95, p99)
- Slow request percentage
- Bottleneck endpoints

---

## 🔐 Rate Limiting

### Configuration
- **Endpoint:** `/verify-code`
- **Limit:** 5 attempts per email in 15 minutes
- **Response:** HTTP 429 (Too Many Requests)

### Environment Variables
```bash
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
RATE_LIMIT_MAX_REQUESTS=5         # Max attempts
```

---

## 🎭 Dark Mode

### Features
- Toggle button in navbar
- Saved to user profile
- Applied to all pages
- Chart.js theme switching

### API Endpoints
```
POST /api/dark-mode
Body: { "enabled": true/false }

GET /api/user-preferences
Returns: { "darkModeEnabled": boolean, "email": string }
```

---

## 🚨 Alert System

### Status Levels
| Status | Condition |
|--------|-----------|
| ✅ HEALTHY | Normal operation |
| ⚠️ DEGRADED | API error rate > 10% |
| 🔴 ALERT | 5+ failed logins in 5 min |
| 🛑 CRITICAL | Database disconnected |

### Auto-Alerts On Dashboard
- High API error rate
- High failed login attempts
- Database disconnection
- System health issues

---

## 📈 Admin API Endpoints

### /admin/dashboard
```bash
GET /admin/dashboard
# Returns: 24-hour metrics snapshot
```

### /admin/api-health
```bash
GET /admin/api-health?hours=24&slowThreshold=1000
# Returns: Endpoint stats and hourly trends
```

### /admin/failed-logins
```bash
GET /admin/failed-logins?hours=24
# Returns: Email/IP/time-based anomalies
```

### /admin/performance
```bash
GET /admin/performance?hours=24&slowThreshold=1000
# Returns: Latency percentiles and bottlenecks
```

### /admin/status
```bash
GET /admin/status
# Returns: System health components
```

---

## 🔧 Environment Configuration

### Admin Access
```bash
ADMIN_EMAILS=admin@example.com
```

### Rate Limiting
```bash
RATE_LIMIT_WINDOW_MS=900000          # 15 min
RATE_LIMIT_MAX_REQUESTS=5             # 5 attempts
```

### Session Management
```bash
SESSION_TIMEOUT_MS=3600000            # 1 hour
```

### Dark Mode
```bash
DARK_MODE_DEFAULT=false               # Default setting
```

---

## 🗄️ Database Collections

### api_health
- Tracks all API requests
- Fields: endpoint, responseTime, status, timestamp
- TTL: 90 days
- Used for: Health metrics, performance analysis

### failed_login_attempts
- Tracks failed authentication
- Fields: email, ip, timestamp, error
- TTL: 30 days
- Used for: Anomaly detection, pattern analysis

### user_profiles
- Stores user preferences
- Fields: email, darkModeEnabled, lastModified
- Used for: Dark mode persistence

---

## 📋 Feature Summary

| Feature | Status | File(s) |
|---------|--------|---------|
| Admin Dashboard | ✅ Complete | admin.html, admin.js |
| Dark Mode | ✅ Complete | style.css, admin.html, script.js |
| Rate Limiting | ✅ Complete | index.js |
| Session Timeout | ✅ Complete | index.js |
| Failed Login Detection | ✅ Complete | index.js |
| Performance Analytics | ✅ Complete | index.js, admin.html |
| System Status Monitoring | ✅ Complete | index.js, admin.html |
| Alert System | ✅ Complete | index.js, admin.html |

---

## 🐛 Troubleshooting

### Admin Dashboard Not Loading
- [ ] Verify email in ADMIN_EMAILS
- [ ] Check browser console for errors
- [ ] Verify MongoDB connection

### No Metrics Showing
- [ ] Wait 30 seconds for auto-refresh
- [ ] Click "Refresh" button manually
- [ ] Check MongoDB collections exist

### Dark Mode Not Saving
- [ ] Verify MongoDB connection
- [ ] Check user_profiles collection exists
- [ ] Clear browser cache

### Rate Limiting Not Working
- [ ] Verify express-rate-limit installed: `npm list express-rate-limit`
- [ ] Check RATE_LIMIT_* env vars
- [ ] Restart server

---

## 📞 Common Tasks

### Add New Admin User
```bash
# Edit .env file:
ADMIN_EMAILS=existing@example.com,new@example.com

# Restart server
```

### Change Rate Limit
```bash
# Edit .env file:
RATE_LIMIT_WINDOW_MS=600000        # 10 minutes
RATE_LIMIT_MAX_REQUESTS=10          # 10 attempts

# Restart server
```

### Change Session Timeout
```bash
# Edit .env file:
SESSION_TIMEOUT_MS=1800000          # 30 minutes

# Restart server
```

### View Real-time Logs
```bash
# Terminal shows:
# ✅ [ADMIN] Dashboard metrics retrieved
# ⚠️ [RATE LIMIT] Brute force attempt detected
# ✅ [API] Health check logged
# 📊 [PERF] Endpoint timing: 145ms
```

---

## 📚 Documentation Files

- **WEB_PORTAL_IMPLEMENTATION_SUMMARY.md** - Overview and completion status
- **ADMIN_DASHBOARD_FEATURES.md** - Detailed feature documentation
- **QUICK_REFERENCE.md** - This file

---

## 🚀 Performance Tips

- Dashboard auto-refreshes every 30 seconds
- Charts rendered only when needed (tab switching)
- Queries limited to 1000 records max
- Aggregation pipeline for efficiency
- TTL indexes for automatic cleanup

---
