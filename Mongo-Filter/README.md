Mongo-FIlter
=============

Purpose
-------
This folder documents the current MongoDB collection validator on `web-portal.license_plates`, explains why it was added, and provides safe scripts and examples for editing, testing, backing up, and reverting the filter.

Current validator (applied 2026-01-01)
-----------------------------------
> **Note:** This validator was applied by the repository maintainer on 2026-01-01 as an example configuration. It was intentionally targeted to focus on LPR-related camera captures (e.g., `LPR Camera Left`) rather than being a generic, site-wide policy — update the regex or target explicit camera IDs if you need to broaden or narrow the scope.

We applied a `collMod` validator which enforces two main things:

1. `camera_name` must not match /Entry|Exit|Kiosk/i (blocks Entry/Exit/Kiosk cameras)
2. `license_plate` must be a string and must not match placeholder patterns like empty / whitespace, `undefined`, `null`, `none`, `no-plate`, `unread`, `-+` (regex is case-insensitive)

The command we used (run in `mongosh` against `web-portal`):

```js
db.runCommand({
  collMod: "license_plates",
  validator: {
    $and: [
      { camera_name: { $not: { $regex: "Entry|Exit", $options: "i" } } },
      { license_plate: { $type: "string" } },
      { license_plate: { $not: { $regex: "^(\\s*|undefined|null|none|no-plate|unread|-+)$", $options: "i" } } }
    ]
  },
  validationLevel: "moderate",
  validationAction: "error"
});
```

Notes on parts:
- `validationLevel: "moderate"` means the rule is enforced on inserts/updates but won't retroactively validate existing documents.
- `validationAction: "error"` causes writes that violate the validator to be rejected.

How to edit the validator
-------------------------
1. Edit the placeholder regex in the `license_plate` clause if you want to add/remove terms.
2. To update, replace the `validator` object using `collMod` again with your updated condition.

Example: modify to add `unknown` to placeholders:
- Update regex to include `|unknown` (and re-run the collMod command above with the new regex).

Testing the validator (dry-run)
-------------------------------
From `mongosh` connected to `web-portal` you can try an insert that should be rejected:

```js
// This should be rejected by the validator as license_plate is 'undefined'
db.license_plates.insertOne({ camera_name: 'LPR Camera Left', license_plate: 'undefined', timestamp: new Date() })
```

If the validator is active you will get an error. If it inserts, your validator does not match.

Backup & delete workflow (safe)
-------------------------------
1. BACKUP: copy matching docs to a timestamped collection:

```js
// backup Entry/Exit and placeholder plates
db.license_plates.aggregate([
  { $match: { $or: [ { camera_name: { $regex: "Entry|Exit", $options: "i" } }, { license_plate: { $type: "string", $regex: "^(\\s*|undefined|null|none|no-plate|unread|-+)$", $options: "i" } } ] } },
  { $out: "license_plates_backups_entry_exit_and_placeholders" }
])
```

2. VERIFY: inspect the backup

```js
db.license_plates_backups_entry_exit_and_placeholders.find().limit(10).pretty()
```

3. DELETE (only after verifying the backup):

```js
db.license_plates.deleteMany({ $or: [ { camera_name: { $regex: "Entry|Exit", $options: "i" } }, { license_plate: { $type: "string", $regex: "^(\\s*|undefined|null|none|no-plate|unread|-+)$", $options: "i" } } ] })
```

Rollback / remove validator
---------------------------
To remove the validator entirely (or set it to empty):

```js
db.runCommand({ collMod: 'license_plates', validator: {}, validationLevel: 'off' })
```

Producer changes / origin
-------------------------
We added an `origin` field to all producer scripts so future documents are labeled with where they came from. Files changed:

- `fast_lpr_capture.py` -> `origin: 'fast_capture'`
- `backfill_protect_hours.py` -> `origin: 'backfill'` (enforces camera filters and plate sanitization using shared helpers to avoid validator rejections)
- `LPR_Notifications/lpr_event_capture.py` -> `origin: 'event_capture'`
- `LPR_Notifications/lpr_websocket_listener.py` -> `origin: 'websocket_listener'`
- `LPR_Notifications/lpr_microservice.py` -> `origin: 'microservice'`
- `LPR_Notifications/lpr_microservice_v2.py` and `lpr_capture_v3.py` -> various `origin` values

This makes it easier to filter/clean per-source going forward.

Scripts in this folder
----------------------
- `apply_validator.sh`: run the collMod command easily (edit variables at top)
- `backup_and_delete_notes.sh`: backup all docs with `notes` and delete originals (safe, creates dated backup)
- `test_insert.sh`: quick insert test to verify validator rejects placeholders

CHANGELOG
---------
See `CHANGELOG.md` for history of changes we made (dates and why).

If you want me to harden or extend the validator (e.g. block specific camera IDs instead of name regex), say the changes and I will prepare a collMod update and test steps.

Recent Actions (summary)
------------------------
2026-01-01 (summary of actions performed):

- Applied initial collection validator to `web-portal.license_plates` to block non-LPR cameras and placeholder plates (this change was applied by the repository maintainer as an example and specifically targets LPR camera names).
  - Validator (applied 2026-01-01): `camera_name` must not match /Entry|Exit/i; `license_plate` must be a string and must not match placeholders (empty, `undefined`, `null`, `none`, `no-plate`, `unread`, `-+`).
  - Later updated to include `Kiosk` in the blocked camera names (validator regex now: `Entry|Exit|Kiosk`).

- Producer hardening:
  - Added `_sanitize_plate()` helper to sanitize and normalize incoming plate values and skip placeholder plates.
  - Added `origin` fields to producers to label records by source (`fast_capture`, `backfill`, `event_capture`, `websocket_listener`, `microservice`, `microservice_v2`, `capture_v3`, etc.).

- Backup & cleanup performed:
  - Backed up and removed Entry/Exit and placeholder documents:
    - Backup: `license_plates_backups_entry_exit_and_placeholders` (created) — **479** documents backed up.
    - Deleted **479** original documents from `license_plates` (removed unwanted Entry/Exit and placeholders).
  - Backed up and removed `notes` documents (user review done, then backup dropped on request):
    - Backup: `license_plates_backups_notes_20260101` — **121** docs backed up.
    - Deleted **121** original `notes` documents from `license_plates`.
    - Backup was dropped by request after review.
  - Backed up and removed `Kiosk` camera documents:
    - Backup: `license_plates_backups_kiosk_20260101` — **2** docs backed up.
    - Deleted **2** `Kiosk` documents from `license_plates`.

- Tagging & verification:
  - Tagged notes-containing Left/Right docs with `origin: "notes"` (121 docs tagged prior to deletion).
  - Verified validator and counts after operations; current `license_plates` total: **3,884** (as of 2026-01-01 after deletions).

- Repo: Created `Mongo-FIlter` folder with README, CHANGELOG, test and maintenance scripts (`apply_validator.sh`, `backup_and_delete_notes.sh`, `test_insert.sh`).

Recommendations & next steps
----------------------------
- For a stronger block, add explicit camera IDs to the validator in addition to name regex; I can gather camera IDs and apply them.
- Add a small scheduled job to snapshot and remove newly-arrived `notes` or non-LPR camera records (we can commit the `backup_and_delete_notes.sh` into a cron job or CI task).
- If you'd like, I can prepare a PR with all code+doc changes and add integration tests for the validator behavior.

If you'd like me to apply any of the above recommendations, tell me which one to do next and I'll prepare the changes and steps.