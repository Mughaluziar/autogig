#!/usr/bin/env bash
# Shared MongoDB Database Tools setup. Source after enabling errexit.
set +x
umask 077

mongo_db_name() {
  if [[ ! "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$ ]]; then
    echo "Invalid database name. Use 1–63 ASCII letters, digits, underscores or hyphens." >&2
    return 2
  fi
}

mongo_tools_config() {
  config_dir="$(mktemp -d "${TMPDIR:-/tmp}/autogig-mongo.XXXXXXXX")"
  trap 'rm -f -- "$mongo_config"; rmdir -- "$config_dir"' EXIT
  mongo_config="$config_dir/tools.yml"
  # A JSON object is valid YAML. Keep the URI out of argv and shell tracing.
  "${PYTHON:-python3}" - >"$mongo_config" <<'PY'
import json
import os
print(json.dumps({"uri": os.environ["MONGODB_URI"]}))
PY
}

mongo_empty_destination() {
  "${PYTHON:-python3}" - "$1" <<'PY'
import os
import sys
from pymongo import MongoClient

with MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=5000) as client:
    if client[sys.argv[1]].list_collection_names():
        raise SystemExit("Refusing to restore into a database with existing collections.")
PY
}
