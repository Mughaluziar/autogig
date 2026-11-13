#!/usr/bin/env bash
# Restore an archive made by mongo-backup.sh.
#
#   MONGODB_URI=... ./mongo-restore.sh backups/autopilot-2026...archive.gz [target_db]
#
# SAFE BY DEFAULT: restores into a *different* database (default
# "<db>_restore_test") and never drops existing collections. To restore over
# production, pass the real name as target_db AND set CONFIRM_OVERWRITE=yes.
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is required}"
ARCHIVE="${1:?usage: mongo-restore.sh <archive.gz> [target_db]}"
SRC_DB="${MONGODB_DB:-autopilot}"
TARGET="${2:-${SRC_DB}_restore_test}"
RESTORE="${MONGORESTORE:-mongorestore}"

if [ "$TARGET" = "$SRC_DB" ] && [ "${CONFIRM_OVERWRITE:-}" != "yes" ]; then
  echo "refusing to restore over '$SRC_DB' without CONFIRM_OVERWRITE=yes" >&2; exit 2
fi

$RESTORE --uri="$MONGODB_URI" --gzip --archive="$ARCHIVE" \
  --nsFrom="${SRC_DB}.*" --nsTo="${TARGET}.*" >/dev/null 2>"${TMPDIR:-/tmp}/mongo-restore.log" || {
  echo "restore FAILED (see ${TMPDIR:-/tmp}/mongo-restore.log)" >&2; exit 1; }
echo "restored $ARCHIVE into database '$TARGET'"
