#!/usr/bin/env bash
# Logical backup of the Autopilot MongoDB database to a compressed archive.
#
#   MONGODB_URI=... MONGODB_DB=autopilot BACKUP_DIR=/var/backups/autopilot ./mongo-backup.sh
#
# Keeps the newest $KEEP archives (default 14). The URI is read from the
# environment only and is never echoed. Needs `mongodump` (MongoDB Database
# Tools); override the command with MONGODUMP="docker run --rm --network host
# -v $PWD:/out mongo:7 mongodump" if it is not installed.
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is required}"
DB="${MONGODB_DB:-autopilot}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
DUMP="${MONGODUMP:-mongodump}"

mkdir -p "$DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DIR/${DB}-${stamp}.archive.gz"

# --uri carries credentials; keep it out of `set -x` traces and process output.
$DUMP --uri="$MONGODB_URI" --db="$DB" --gzip --archive="$out" >/dev/null 2>"$DIR/.last-backup.log" || {
  echo "backup FAILED (see $DIR/.last-backup.log)" >&2; rm -f "$out"; exit 1; }

[ -s "$out" ] || { echo "backup FAILED: empty archive" >&2; rm -f "$out"; exit 1; }
echo "backup ok: $out ($(du -h "$out" | cut -f1))"

# Retention: delete everything but the newest $KEEP archives for this database.
ls -1t "$DIR/${DB}-"*.archive.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
