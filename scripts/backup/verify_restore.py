#!/usr/bin/env python3
"""Compare a restored database with its source: collections, document counts, per-document content hashes and
index definitions (including unique and TTL options). Read-only on both databases.

    MONGODB_URI=mongodb://... python scripts/backup/verify_restore.py <source_db> <restored_db>

Needs pymongo (it ships with backend/requirements.txt). Exit code 0 only if everything matches. Never prints
document contents or the connection string. Notes:
  * Collections with a TTL index (sessions, login failures, notifications, activity ...) delete expired documents
    on their own, in the source and in the restore. If a drill runs long after the backup, a handful of such
    documents can legitimately differ; the report lists them separately as TTL_COLLECTIONS.
"""
import hashlib
import json
import os
import sys

from bson import json_util
from pymongo import MongoClient


def fingerprint(doc: dict) -> str:
    return hashlib.sha256(json.dumps(doc, sort_keys=True, default=json_util.default).encode()).hexdigest()


def index_signature(index: dict) -> tuple:
    keep = {k: v for k, v in index.items() if k not in ("v", "ns")}
    return (keep["name"], json.dumps(keep, sort_keys=True, default=str))


def main() -> int:
    if len(sys.argv) != 3 or not os.environ.get("MONGODB_URI"):
        print(__doc__)
        return 2
    src_name, dst_name = sys.argv[1], sys.argv[2]
    if src_name == dst_name:
        print("source and restored database must differ")
        return 2
    client = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=8000)
    src, dst = client[src_name], client[dst_name]
    problems: list[str] = []
    ttl: set[str] = set()
    src_cols = sorted(c for c in src.list_collection_names() if not c.startswith("system."))
    dst_cols = sorted(c for c in dst.list_collection_names() if not c.startswith("system."))
    docs_total = idx_total = 0
    for missing in sorted(set(src_cols) - set(dst_cols)):
        problems.append(f"collection missing in the restore: {missing}")
    for extra in sorted(set(dst_cols) - set(src_cols)):
        problems.append(f"unexpected extra collection in the restore: {extra}")
    for name in sorted(set(src_cols) & set(dst_cols)):
        s_idx = {index_signature(i) for i in src[name].list_indexes()}
        d_idx = {index_signature(i) for i in dst[name].list_indexes()}
        idx_total += len(s_idx)
        if any("expireAfterSeconds" in json.loads(sig[1]) for sig in s_idx):
            ttl.add(name)
        for sig in sorted(s_idx - d_idx):
            problems.append(f"{name}: index not restored: {sig[0]}")
        for sig in sorted(d_idx - s_idx):
            problems.append(f"{name}: unexpected index in the restore: {sig[0]}")
        s_docs = {str(d["_id"]): fingerprint(d) for d in src[name].find({})}
        d_docs = {str(d["_id"]): fingerprint(d) for d in dst[name].find({})}
        docs_total += len(s_docs)
        if len(s_docs) != len(d_docs):
            problems.append(f"{name}: {len(s_docs)} documents in the source, {len(d_docs)} in the restore"
                            + (" (TTL collection)" if name in ttl else ""))
        changed = [k for k in s_docs if k in d_docs and s_docs[k] != d_docs[k]]
        lost = [k for k in s_docs if k not in d_docs]
        if changed:
            problems.append(f"{name}: {len(changed)} documents differ in content")
        if lost and len(s_docs) == len(d_docs):
            problems.append(f"{name}: {len(lost)} documents missing (different ids)")
    print(f"collections: {len(src_cols)} source / {len(dst_cols)} restored; documents compared: {docs_total}; indexes compared: {idx_total}")
    print("TTL_COLLECTIONS:", ", ".join(sorted(ttl)) or "none")
    if problems:
        print("VERIFY FAILED")
        for p in problems:
            print(" -", p)
        return 1
    print("VERIFY OK: every collection, document and index matches")
    return 0


if __name__ == "__main__":
    sys.exit(main())
