#!/usr/bin/env bash
# Restores a compressed archive into an empty database by default.
set -euo pipefail
source "$(dirname "$0")/mongo-tools.sh"

: "${MONGODB_URI:?MONGODB_URI is required}"
ARCHIVE="${1:?usage: mongo-restore.sh <archive.gz> [target_db]}"
SRC_DB="${MONGODB_DB:-autopilot}"
TARGET="${2:-${SRC_DB}_restore_test}"
read -r -a restore <<< "${MONGORESTORE:-mongorestore}"
mongo_db_name "$SRC_DB"
mongo_db_name "$TARGET"

if [[ "${CONFIRM_OVERWRITE:-}" != yes ]]; then
  if [[ "$TARGET" == "$SRC_DB" ]]; then
    echo "Refusing to restore over the source database." >&2
    exit 2
  fi
  mongo_empty_destination "$TARGET"
fi

mongo_tools_config
log="$(mktemp "${TMPDIR:-/tmp}/autogig-restore.XXXXXXXX.log")"
if ! "${restore[@]}" --config="$mongo_config" --gzip --archive --stopOnError \
  --nsFrom="$SRC_DB.*" --nsTo="$TARGET.*" <"$ARCHIVE" >/dev/null 2>"$log"; then
  echo "Restore failed. Private log: $log" >&2
  exit 1
fi
rm -f -- "$log"
echo "Restored $ARCHIVE into database '$TARGET'."
