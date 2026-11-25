#!/usr/bin/env bash
# Logical backup to a private compressed archive. Set MONGODB_URI and MONGODB_DB.
set -euo pipefail
source "$(dirname "$0")/mongo-tools.sh"

: "${MONGODB_URI:?MONGODB_URI is required}"
DB="${MONGODB_DB:-autopilot}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
read -r -a dump <<< "${MONGODUMP:-mongodump}"
mongo_db_name "$DB"
if [[ ! "$KEEP" =~ ^[1-9][0-9]{0,5}$ ]]; then
  echo "KEEP must be a positive integer." >&2
  exit 2
fi

mkdir -p -- "$DIR"
mongo_tools_config
stamp="$(date -u +%Y%m%dT%H%M%S%NZ)"
temporary="$(mktemp "$DIR/.autogig-backup.XXXXXXXX")"
out="$DIR/$DB-$stamp-${temporary##*.}.archive.gz"
log="$(mktemp "$DIR/.autogig-dump.XXXXXXXX.log")"
if ! "${dump[@]}" --config="$mongo_config" --db="$DB" --gzip --archive >"$temporary" 2>"$log" || [[ ! -s "$temporary" ]]; then
  rm -f -- "$temporary"
  echo "Backup failed. Private log: $log" >&2
  exit 1
fi
mv -- "$temporary" "$out"
rm -f -- "$log"
printf '%s\n' "$out"

mapfile -d '' -t archives < <(find "$DIR" -maxdepth 1 -type f -name "$DB-*.archive.gz" -print0 | sort -zr)
for stale in "${archives[@]:KEEP}"; do
  rm -f -- "$stale"
done
