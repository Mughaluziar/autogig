"""Small keyed documents for the token program: the indexer cursor, wallet
link challenges, the last reconciliation, and launch-gate items. MongoDB
collection `token_state` (`_id` = key), with the usual in-memory fallback."""
from copy import deepcopy

from .. import db

_mem: dict[str, dict] = {}


def reset_memory() -> None:
    _mem.clear()


async def get(key: str) -> dict | None:
    if not db.enabled():
        return deepcopy(_mem.get(key))
    doc = await db._get_db().token_state.find_one({"_id": key})
    if doc:
        doc.pop("_id", None)
    return doc


async def put(key: str, value: dict) -> None:
    if not db.enabled():
        _mem[key] = deepcopy(value)
        return
    await db._get_db().token_state.replace_one({"_id": key}, {"_id": key, **value}, upsert=True)


async def delete(key: str) -> None:
    if not db.enabled():
        _mem.pop(key, None)
        return
    await db._get_db().token_state.delete_one({"_id": key})


async def prefixed(prefix: str) -> dict[str, dict]:
    if not db.enabled():
        return {k: deepcopy(v) for k, v in _mem.items() if k.startswith(prefix)}
    cursor = db._get_db().token_state.find({"_id": {"$regex": f"^{prefix}"}})
    return {d.pop("_id"): d async for d in cursor}
