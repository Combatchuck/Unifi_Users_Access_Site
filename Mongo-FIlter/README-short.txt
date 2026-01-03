Short: validator blocks Entry/Exit camera_name and placeholder plates
Commands to view validator:
  mongosh "$MONGO_URL" --quiet --eval 'printjson(db.getCollectionInfos({name:"license_plates"})[0].options.validator)'
Change regex in apply_validator.sh and re-run to update
Backup and delete examples available in backup_and_delete_notes.sh
