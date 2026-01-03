# Web Portal
This will be the web portal for the UniFi Access system.

### Configuration

- `SHOW_LPR_DATA=YES|NO` — Controls whether LPR data (tiles on Home, per-plate last-seen, counts, and the `LPR Query` link) is shown on the public site (default `YES`). When set to `NO`, the public UI hides LPR data and the `/lpr-dashboard` route returns 404; admin dashboards and API endpoints remain accessible to authorized users.

## Features
- User authentication with email and verification code
- View and manage managed users
- Change PIN for both the gate and the clubhouse/pool
- Add and remove license plates
- Send invites to new users
- Logout

## New Features
- When a user enters a PIN or Plate that doesnt meet requirments, a message will be displayed to the user.
- When a user clicks the submit button, a loading overlay will be displayed to the user.
- The server-side validation has been improved to be more robust.
- The error messages have been improved to be more descriptive.
