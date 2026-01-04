Notes - Mongo Filter
=====================

- Keep this doc updated when validator rules change.
- If you need to add more placeholder patterns (e.g., 'TEMP', 'UNKNOWN'), add them to the regex in the README and use `apply_validator.sh` to update.
- Always backup matching documents before deleting or changing the validator.

Quick checklist:
- [ ] Edit regex in `apply_validator.sh` and test locally (use `test_insert.sh`).
- [ ] Create a dated backup before any deletion.
- [ ] Keep backups for at least 7 days unless disk pressure requires earlier deletion.

Contact: admin@example.com (for questions)