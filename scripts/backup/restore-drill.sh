#!/usr/bin/env bash
# Backup, restore into a new scratch database, verify, and optionally keep it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/mongo-tools.sh"
: "${MONGODB_URI:?MONGODB_URI is required}"
DB="${MONGODB_DB:-autopilot}"
PY="${PYTHON:-python3}"
mongo_db_name "$DB"

target="autogig_restore_$("$PY" -c 'import secrets; print(secrets.token_hex(12))')"
start=$(date +%s)
archive="$(bash "$here/mongo-backup.sh")"
CONFIRM_OVERWRITE=no bash "$here/mongo-restore.sh" "$archive" "$target"
"$PY" "$here/verify_restore.py" "$DB" "$target"
echo "Drill completed in $(( $(date +%s) - start )) s."
if [[ "${DRILL_KEEP:-no}" != yes ]]; then
  "$PY" - "$target" <<'PY'
import os
import sys
from pymongo import MongoClient

with MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=5000) as client:
    client.drop_database(sys.argv[1])
PY
else
  echo "Scratch database retained: $target"
fi
