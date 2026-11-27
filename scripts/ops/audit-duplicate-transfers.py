#!/usr/bin/env python3
"""Read-only audit: bank_transfers that share (user_id, idem). Run before deploying the unique index
`one_transfer_per_request` (backend/app/capital/store.py), which can't be built while duplicates exist and would then
stop the API at startup.

  MONGODB_URI=... MONGODB_DB=autopilot python scripts/ops/audit-duplicate-transfers.py

Use a database user with the read role only. The URI is read from the environment (never argv) and never printed.
The script runs one aggregation and a count: it writes, updates and deletes nothing. It prints user ids, transfer ids,
kinds, amounts, statuses and ledger sequence numbers, no names or emails. Exit code 1 when duplicates exist.
"""
import os
import sys

from pymongo import MongoClient
from pymongo.read_concern import ReadConcern

uri, name = os.environ.get("MONGODB_URI", ""), os.environ.get("MONGODB_DB", "")
if not uri or not name:
    sys.exit("Set MONGODB_URI and MONGODB_DB (read-only user).")
client = MongoClient(uri, serverSelectionTimeoutMS=10_000, appname="autogig-duplicate-transfer-audit")
coll = client[name].get_collection("bank_transfers", read_concern=ReadConcern("majority"))
total = coll.count_documents({})
groups = list(coll.aggregate([
    {"$match": {"idem": {"$type": "string"}}},
    {"$group": {"_id": {"user_id": "$user_id", "idem": "$idem"}, "n": {"$sum": 1},
                "rows": {"$push": {"id": "$id", "kind": "$kind", "amount_cents": "$amount_cents", "status": "$status",
                                   "seq": "$seq", "created_at": "$created_at"}}}},
    {"$match": {"n": {"$gt": 1}}},
], allowDiskUse=True))
print(f"database {name}: {total} transfers, {len(groups)} duplicated request keys")
for g in groups:
    posted = sum(1 for r in g["rows"] if r.get("seq") is not None)
    print(f"- user {g['_id']['user_id']} key ...{str(g['_id']['idem'])[-6:]}: {g['n']} records, {posted} posted to the ledger")
    for r in g["rows"]:
        print(f"    {r.get('id')} {r.get('kind')} {r.get('amount_cents')} {r.get('status')} seq={r.get('seq')} {r.get('created_at')}")
client.close()
sys.exit(1 if groups else 0)
