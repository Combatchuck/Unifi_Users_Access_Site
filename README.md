# Web Portal
This repository contains the Web Portal used to simplify and centralize administration of Access and User-related tasks (PINs, Invites, License Plates, Sessions, and system health). It was created to remove the burden of manually handling repetitive administrative work and to provide clear operational visibility for site admins.

---

## Quick Overview ✅
- Purpose: Let site admins manage users, reset PINs, send Identity invites, add/remove license plates, and monitor system health from a single dashboard.
- Interfaces included:
  - **User-facing flows** (email sign-in + verification, user dashboard, visitor dashboard)
  - **Admin Dashboard** (health, security, sessions, audit log, license plate metrics)
  - **LPR (License Plate Recognition) Dashboard** for querying captured plate data

---

## Authentication Flow 🔐
1. User enters their email on the site.
2. The site sends a verification code to the email address.
3. The user enters the code to verify.

These steps produce a session and then the site shows the appropriate dashboards (User -> Visitor flows).

<p align="center">
  <img src="Pictures/Enter%20Email.png" alt="Enter Email" width="360" />
  <img src="Pictures/Enter%20Code.png" alt="Enter Code" width="360" />
</p>
*Top: Enter Email — Bottom: Enter Code — users verify via code to sign in.*

---

## User & Visitor Dashboards
- **User Dashboard:** shows the user-specific controls and status. The site will display the user's profile avatar if one exists; otherwise the fallback image `Avatars/default.png` is used.

<p align="center">
  <img src="Pictures/User%20Dash.png" alt="User Dashboard" width="800" />
</p>
*User Dashboard — personal settings, plates, PINs, invites.*

- **Visitor Dashboard:** shows visitor-specific controls and added visitor plates and management.

<p align="center">
  <img src="Pictures/Visitor%20Dash.png" alt="Visitor Dashboard" width="800" />
</p>
*Visitor Dashboard — guest plates and visit details.*

**Environment customization:** You can customize certain UI elements via `.env`:
- `SITE_NAME` — set the display name for your site (defaults to "User Access Portal").
- `INVITE_SITE_COUNT` — number of invite buttons shown (1 or 2, defaults to 2).
- `INVITE_SITE1_NAME`, `INVITE_SITE2_NAME` — labels for each invite destination.
See `.env.example` for defaults and examples.

---

## Admin Dashboard 🔧
The admin UI is at `public/admin.html` and includes (screenshots below):

<p align="center">
  <img src="Pictures/Admin%201.png" alt="Admin 1" width="320" />
  <img src="Pictures/Admin%202.png" alt="Admin 2" width="320" />
  <img src="Pictures/Admin%203.png" alt="Admin 3" width="320" />
</p>
<p align="center">
  <img src="Pictures/Admin%204.png" alt="Admin 4" width="320" />
  <img src="Pictures/Admin%205.png" alt="Admin 5" width="320" />
</p>
*Admin screenshots: Overview, Metrics, Sessions, Audit Log, License Plates.*

- System status badge and manual refresh controls
- Main metrics and charts (API health, trends, error rates)
- Security & failed login monitoring (summary, anomalies, timeline)
- Performance analytics (requests, latency, P95/P99)
- System health & uptime details
- Database monitoring (DB status, active connections, query performance)
- Session management (search by email/IP, revoke individual sessions, **Revoke All Sessions**)
- User activity and top actions reporting
- License Plate metrics (total, added/removed today)
- PIN management summary (changes today)
- Visitor management (active visitors, expiring soon)
- Authentication health (failed logins, invalid email attempts)
- Invitations metrics (pending, sent, accepted)
- Top users and top actions (last 7 days)
- Audit log with filters by email/action/time range and a live list of events

Admin features are driven by `admin.js` and display interactive charts and tables with refresh buttons and tabs for different views.

---

## LPR (License Plate Recognition) Dashboard 🚗
- The LPR UI is at `public/lpr-dashboard.html` and provides a query UI for captured LPR data.

<p align="center">
  <img src="Pictures/LRP%20Query.png" alt="LPR Query" width="900" />
</p>
*LPR Query — search plates, filter by camera, confidence, date, and add notes to results.*
- Features:
  - Search by plate, user name, email, camera, vehicle color, vehicle type, confidence, and date/time range
  - Metrics panel and results table with pagination
  - Per-result notes with save support
  - Filters and quick actions for "identified" vs "unidentified" plates
- Configuration: `SHOW_LPR_DATA=YES|NO` in `.env` controls whether LPR functionality and links are exposed in the public UI (default: `YES`). When set to `NO`, the public site will remove LPR-specific elements (LPR tiles on Home, per-plate last-seen and counts, and the "🚗 LPR Query" nav link) and attempts to access `/lpr-dashboard.html` will return 404/not-available. Admin dashboards and LPR-related backend APIs remain accessible to authorized users. See `.env.example` for the default value.

---

## Typical Admin Actions
- Reset a user PIN
- Send a new Identity invite
- Add / remove license plates for users or visitors
- Revoke sessions or revoke all sessions for an email
- Inspect failed login anomalies and lock down suspicious IPs
- Review audit logs and export or search by action type

---

## Where to look in the codebase 🔎
- `public/admin.html` — Admin UI markup & layout
- `public/admin.js` — Admin UI client logic and API calls
- `public/lpr-dashboard.html` — LPR query UI
- `public/header.js` — Nav and LPR link logic (controlled by `SHOW_LPR_DATA`)
- `Pictures/` — UI screenshots used in this README (Enter Email, Enter Code, User Dash, Visitor Dash, Admin 1–5, LRP Query)

---

## Notes & Contributions ✨
If you want to add more screenshots or update the flows, drop the images into `Pictures/` and update this README with new paths. Contributions to improve documentation, fix UI copy, or add more admin automation are welcome.

---

*Last updated: Jan 3, 2026*
