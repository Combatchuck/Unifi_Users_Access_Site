CHANGELOG
=========

2026-01-01 - Applied collection validator to `license_plates` to block Entry/Exit camera names and placeholder plates. Added sanitization in capture/backfill scripts to avoid writing placeholders. Ran profiler and removed unwanted docs; added origin tagging.

2026-01-01 - Backed up and removed documents with `notes` (backup created `license_plates_backups_notes_20260101` and then deleted; backup later dropped on user request).

2026-01-01 - Backed up and removed `Kiosk` camera documents (backup `license_plates_backups_kiosk_20260101`, **2** docs backed up and deleted). Updated validator to include `Kiosk` (regex now: `Entry|Exit|Kiosk`).

2026-01-01 - Backed up and removed Entry/Exit/placeholder records (backup `license_plates_backups_entry_exit_and_placeholders`, **479** docs; **479** deleted).

2026-01-01 - Tagged `notes` docs with `origin: "notes"` prior to removal (**121** docs). Updated producer scripts to add `origin` fields and added `_sanitize_plate()` helper to sanitize plates before writes.

2026-01-03 - Added `LPR_Notifications/lpr_helpers.py` and used it from `backfill_protect_hours.py` to enforce camera filters and plate sanitization; added `scripts/test_lpr_guards.py` to validate guard logic and prevent validator rejections.
2026-01-03 - Added CI workflow (`.github/workflows/lpr-ci.yml`) to run guard tests and an optional integration test that validates startup catchup behavior (requires self-hosted runner and repository secrets).

(Record additional changes here as you edit the filter or scripts.)