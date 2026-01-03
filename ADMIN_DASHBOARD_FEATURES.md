# Admin Dashboard - Complete Implementation Guide

## Overview
This document describes the comprehensive admin dashboard and advanced security features implemented in the access management portal. The implementation includes 6 new API endpoints, a full-featured admin dashboard UI, dark mode support, and sophisticated anomaly detection.

## Features Implemented

### 1. Admin Dashboard API Endpoints

#### `/admin/dashboard` (GET)
- **Access:** Admin-only (requireAdmin middleware)
- **Purpose:** Main dashboard aggregating 24-hour metrics
- **Returns:**
  - API metrics: total requests, average response time, failed requests, failure rate
  - Security metrics: failed login attempts, unique users with failed attempts
  - Activity metrics: visitor modifications
  - Top 10 endpoints by request count with average response times

**Example Response:**
```json
{
  "lastUpdated": "2024-01-15T10:30:00Z",
  "metrics": {
    "api": {
      "totalRequests": 1250,
      "avgResponseTime": 145.32,
      "failedRequests": 18,
      "failureRate": 1.44
    },
    "security": {
      "failedLogins": 5,
      "uniqueFailedUsers": 3
    },
    "activity": {
      "visitorModifications": 42
    },
    "topEndpoints": [...]
  }
}
```

#### `/admin/api-health` (GET)
- **Access:** Admin-only
- **Query Parameters:**
  - `hours` (default: 24) - Time period to analyze
- **Purpose:** Detailed API health metrics and trends
- **Returns:**
  - Per-endpoint statistics (requests, success rate, response times)
  - Hourly trend data (error rates, response time trends)
  - Recent errors with timestamps and HTTP status codes

**Key Metrics Per Endpoint:**
- Total requests
- Success/failure counts
- Success rate percentage
- Average, min, max response times
- Recent errors with details

#### `/admin/failed-logins` (GET)
- **Access:** Admin-only
- **Query Parameters:**
  - `hours` (default: 24) - Time period to analyze
- **Purpose:** Failed login tracking with pattern analysis and anomaly detection
- **Returns:**
  - Email-based patterns: attempts per email, unique IPs, time ranges
  - IP-based patterns: attempts per IP, targeted emails
  - Time-based clustering: 5-minute windows showing spike detection
  - Anomaly flags for suspicious activity
  - Recent failed login attempts

**Anomaly Detection Logic:**
- **Email Anomalies:** Flagged if 3+ attempts OR 3+ different IPs
- **IP Anomalies:** Flagged if 5+ attempts OR 3+ different target emails
- **Time-based Spikes:** Flagged if 5+ attempts in a 5-minute window

#### `/admin/performance` (GET)
- **Access:** Admin-only
- **Query Parameters:**
  - `hours` (default: 24) - Time period to analyze
  - `slowThreshold` (default: 1000) - Milliseconds for "slow" classification
- **Purpose:** Performance analytics with percentile analysis
- **Returns:**
  - Endpoint latency statistics (p50, p95, p99, max)
  - Slow request percentage per endpoint
  - Bottleneck identification
  - Request counts per endpoint

**Percentile Analysis:**
- p50: Median response time
- p95: 95th percentile (typical slow requests)
- p99: 99th percentile (very slow requests)
- Slow request percentage (responses > threshold)

#### `/admin/status` (GET)
- **Access:** Admin-only
- **Purpose:** Real-time system health status
- **Returns:**
  - Overall system status (HEALTHY, DEGRADED, ALERT, CRITICAL, UNKNOWN, ERROR)
  - Component status:
    - Database: CONNECTED/DISCONNECTED
    - API: OPERATIONAL/NO DATA
    - Security: NORMAL/ALERT
  - Error rate last hour
  - Request counts last hour
  - Failed login attempts last 5 minutes
  - List of active issues

**Status Determination Logic:**
- HEALTHY: No errors, normal operation
- DEGRADED: Error rate > 10%
- ALERT: 5+ failed login attempts in last 5 minutes
- CRITICAL: Database disconnected or other critical failures

### 2. Dark Mode Support

#### `POST /api/dark-mode`
- **Access:** Authenticated users only
- **Request Body:** `{ "enabled": boolean }`
- **Purpose:** Save user's dark mode preference
- **Storage:** user_profiles MongoDB collection
- **Session:** Also stored in session for immediate use

#### `GET /api/user-preferences`
- **Access:** Authenticated users only
- **Purpose:** Retrieve user settings including dark mode preference
- **Returns:** `{ "darkModeEnabled": boolean, "email": string }`

**Dark Mode Implementation:**
- CSS variables and theme classes in style.css
- Frontend toggle button in navbar
- Auto-loads preference on page load
- Persists across sessions
- Applies to all pages (dashboard, admin, main site)
- Complementary color scheme for dark mode

### 3. Admin Dashboard UI

**File:** `public/admin.html` (15.5 KB)

#### Dashboard Sections:

1. **Main Metrics (Dashboard View)**
   - API Requests (24h)
   - Average Response Time
   - Failed Requests with Failure Rate
   - Failed Login Attempts with Unique User Count
   - Visitor Modifications

2. **System Status**
   - Database connectivity status
   - API operational status
   - Security status
   - Real-time issue alerts

3. **API Health & Performance**
   - Health Overview tab: Bar chart of endpoint success rates
   - Endpoint Stats tab: Detailed table of all endpoints
   - Trends tab: Line chart showing hourly error rates and response times

4. **Security & Failed Logins**
   - Summary tab: Key metrics about login attempts
   - Anomalies tab: Two tables showing suspicious patterns
   - Timeline tab: Bar chart of attempt frequency over time

5. **Performance Analytics**
   - Total requests count
   - Average latency
   - Bottleneck count
   - Detailed performance table with latency percentiles

#### UI Features:
- Tab-based navigation for detailed analysis
- Chart.js integration for data visualization
- Responsive grid layout
- Color-coded status badges
- Auto-refresh every 30 seconds
- Manual refresh buttons
- Dark mode support
- Alert banners for critical issues
- Anomaly highlighting
- Real-time updates

### 4. Admin Dashboard JavaScript

**File:** `public/admin.js` (17.4 KB)

#### Core Functionality:

1. **Data Aggregation**
   - Parallel API calls to all admin endpoints
   - 30-second auto-refresh cycle
   - Error handling and retry logic

2. **Chart Integration**
   - Chart.js library for 4 dynamic charts
   - Health overview (bar chart)
   - Trends (multi-axis line chart)
   - Timeline (spike detection bar chart)
   - Dynamic theme switching for dark mode

3. **Anomaly Display**
   - Email anomalies with pattern analysis
   - IP-based threat detection
   - Visual highlighting of suspicious activity
   - Time-based spike detection

4. **Dark Mode Integration**
   - Load user preference on page load
   - Toggle functionality
   - Chart theme switching
   - CSS class application

### 5. Rate Limiting (Previously Implemented)

- **Endpoint:** `/verify-code`
- **Type:** Email-based rate limiting
- **Configuration:**
  - Window: 15 minutes (configurable via `RATE_LIMIT_WINDOW_MS`)
  - Max attempts: 5 per email (configurable via `RATE_LIMIT_MAX_REQUESTS`)
  - Breach logging: Logged to MongoDB `rate_limit_breaches` collection

### 6. Session Management

- **Timeout:** 1 hour (3600000ms, configurable via `SESSION_TIMEOUT_MS`)
- **Storage:** MongoDB via connect-mongo
- **Auto-logout:** Session expires after 1 hour of inactivity
- **Dark mode:** Persisted in session for immediate UI updates

## Database Collections

### New Collections Used by Admin Features:

1. **api_health**
   - Tracks all API requests
   - Stores: endpoint, responseTime, status, timestamp, error (if any)
   - TTL: 90 days
   - Indexed by: endpoint, timestamp

2. **failed_login_attempts**
   - Tracks failed authentication attempts
   - Stores: email, ip, timestamp, error reason
   - TTL: 30 days
   - Indexed by: email, timestamp

3. **user_profiles**
   - Stores user preferences (dark mode)
   - Stores: email, darkModeEnabled, lastModified
   - Indexed by: email, lastModified

4. **rate_limit_breaches** (Optional)
   - Logs rate limit violations
   - Stores: email, ip, timestamp, attempts_in_window

## Configuration

### Environment Variables

```bash
# Admin Configuration
ADMIN_EMAILS=admin@example.com

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000          # 15 minutes
RATE_LIMIT_MAX_REQUESTS=5             # 5 attempts per window

# Session Management
SESSION_TIMEOUT_MS=3600000            # 1 hour

# Dark Mode Default
DARK_MODE_DEFAULT=false               # Default for new users

# LPR Visibility
SHOW_LPR_DATA=YES                     # YES to show LPR tiles, last seen, counts, and the LPR Query link; set NO to hide all LPR-related UI

**Admin dashboard LPR data:** The admin dashboard continues to show LPR metrics to admin users regardless of `SHOW_LPR_DATA`. This includes: total detections, `detections_today`, unique plates, average OCR confidence (`avg_confidence_all` / `avg_confidence_today`), per-camera counts and most recent detections, identified/unidentified detection lists, and per-plate detection details (timestamps, thumbnails, notes). **`SHOW_LPR_DATA` only affects the public UI and the `/lpr-dashboard` route; API endpoints remain available to authorized/admin users.**

```

> **Note:** These configuration values are controlled via the project's `.env` file (and shown in `.env.example`). In this repository the committed `.env` currently sets `RATE_LIMIT_MAX_REQUESTS=10` — update `.env.example` and your `.env` to change defaults and avoid committing real credentials.

## Security Features

### Admin Authentication
- Email-based access control via `ADMIN_EMAILS` environment variable
- `requireAdmin()` middleware checks against whitelist
- Protects all `/admin/*` endpoints
- Logs unauthorized access attempts

### Data Protection
- All metrics are aggregated at query time (no pre-aggregation)
- Failed login detection uses heuristics, not stored flags
- Anomaly scores calculated dynamically
- No personally identifiable information in error logs

### Audit Trail
- API health metrics logged for all requests
- Failed login attempts tracked with IP and timestamp
- Rate limit breaches logged
- System status monitored continuously

## Access Control

### Route Protection

```javascript
// Requires authentication AND admin role
app.get('/admin/*', requireLogin, requireAdmin, ...)

// Requires authentication only
app.post('/api/dark-mode', requireLogin, ...)
app.get('/api/user-preferences', requireLogin, ...)
```

### Navbar Links
- Admin Dashboard link: Hidden until user logs in
- Logout link: Hidden until user logs in
- Dark mode toggle: Always available
- Links visible to all authenticated users, but admin dashboard requires admin role

## Performance Considerations

### Query Optimization
- Time-windowed queries (last 24h, 1h, etc.)
- Limit on result sets (1000 health records, 20 recent attempts)
- Aggregation pipeline for grouped data
- Index usage for timestamp and email queries

### Frontend Optimization
- Auto-refresh every 30 seconds (configurable)
- Parallel API calls for faster data loading
- Chart.js efficient rendering
- Lazy chart initialization

### Database Optimization
- TTL indexes for automatic data cleanup
- Compound indexes on high-cardinality fields
- Single query per endpoint (no N+1 queries)

## Testing the Features

### Access Admin Dashboard
1. Log in with an admin email (from ADMIN_EMAILS env var)
2. Click "Admin Dashboard" in the navbar
3. Dashboard should load with real-time metrics

### Test Dark Mode
1. Click the "🌙 Dark Mode" toggle in the navbar
2. Page should switch to dark theme
3. Preference saved to database
4. Reload page - preference persists

### Monitor Failed Logins
1. Attempt login with wrong code 5+ times
2. Check `/admin/failed-logins` endpoint
3. View "Security & Failed Logins" tab on dashboard
4. Observe anomaly detection in action

### View Performance Metrics
1. Navigate to Admin Dashboard
2. Click "Performance Analytics" section
3. View endpoint latency percentiles
4. Check for bottleneck endpoints

### Check System Status
1. Navigate to Admin Dashboard
2. Check status badge in header
3. View "System Status" section
4. See component statuses and active issues

## Future Enhancement Ideas

1. **Email Alerts**
   - Send emails to ADMIN_EMAILS for critical events
   - Configurable thresholds
   - Digest summaries

2. **Data Export**
   - Export metrics as CSV/JSON
   - Report generation
   - Historical comparisons

3. **Custom Dashboards**
   - User-created dashboard widgets
   - Custom date ranges
   - Saved filters

4. **Real-time Notifications**
   - WebSocket integration
   - Push notifications
   - Live metric updates

5. **Advanced Analytics**
   - Machine learning anomaly detection
   - Predictive alerts
   - Trend forecasting

## Troubleshooting

### Admin Dashboard Not Loading
- Verify ADMIN_EMAILS environment variable is set
- Check user email matches admin email
- Check browser console for JavaScript errors
- Verify Chart.js CDN is accessible

### Metrics Not Appearing
- Check MongoDB connection
- Verify api_health collection exists
- Check time range filters
- Wait 30+ seconds for auto-refresh

### Dark Mode Not Persisting
- Check MongoDB connectivity
- Verify user_profiles collection exists
- Check browser console for fetch errors
- Clear browser cache and reload

### Rate Limiting Not Working
- Verify express-rate-limit installed (npm list express-rate-limit)
- Check RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS env vars
- Verify rate_limit_breaches collection exists
- Check /verify-code endpoint logs

## API Documentation

### Admin Dashboard Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| /admin/dashboard | GET | Admin | Main metrics (24h) |
| /admin/api-health | GET | Admin | Health details & trends |
| /admin/failed-logins | GET | Admin | Login patterns & anomalies |
| /admin/performance | GET | Admin | Latency percentiles |
| /admin/status | GET | Admin | System health status |
| /api/dark-mode | POST | User | Save dark mode preference |
| /api/user-preferences | GET | User | Get user settings |

All endpoints return JSON responses with appropriate HTTP status codes.

---

**Implementation Date:** January 2024
**Version:** 1.0
**Maintainer:** Web Portal Team
