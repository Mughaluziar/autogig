#!/usr/bin/env bash
# One-command restore drill: backup -> restore into a scratch database -> verify everything matches.
# Non-destructive: the source is only read, the restore goes into "<db>_restore_test", never over the source.
#
#   MONGODB_URI=... MONGODB_DB=autopilot BACKUP_DIR=./backups scripts/backup/restore-drill.sh
#
# Run it against a disposable database, or against a copy; do NOT point it at production unless you have
# agreed to read it (a dump reads every document). Set DRILL_KEEP=yes to keep the scratch database.
# Needs mongodump/mongorestore (or MONGODUMP/MONGORESTORE docker overrides, see mongo-backup.sh) and python3 + pymongo.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${MONGODB_URI:?MONGODB_URI is required}"
DB="${MONGODB_DB:-autopilot}"
DIR="${BACKUP_DIR:-./backups}"
PY="${PYTHON:-python3}"
start=$(date +%s)
# mongorestore ADDS documents to whatever is already there, so the scratch database must start empty.
# Only "<db>_restore_test" is ever dropped, never the source.
"$PY" - <<PYEOF
import os
from pymongo import MongoClient
MongoClient(os.environ["MONGODB_URI"]).drop_database("${DB}_restore_test")
PYEOF
bash "$here/mongo-backup.sh"
archive="$(ls -1t "$DIR/${DB}-"*.archive.gz | head -1)"
bash "$here/mongo-restore.sh" "$archive"
"$PY" "$here/verify_restore.py" "$DB" "${DB}_restore_test"
echo "drill completed in $(( $(date +%s) - start )) s"
if [ "${DRILL_KEEP:-no}" != "yes" ]; then
  "$PY" - <<PYEOF
import os
from pymongo import MongoClient
MongoClient(os.environ["MONGODB_URI"]).drop_database("${DB}_restore_test")
print("scratch database ${DB}_restore_test dropped")
PYEOF
fi
