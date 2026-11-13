"""Read-only chain access (JSON-RPC over httpx) and ABI helpers.

The backend never signs or sends transactions and never holds a key. It
reads confirmed state and drafts calldata that the treasury Safe's signers
review and execute themselves.
"""
import itertools

import httpx
from eth_abi import decode, encode
from eth_utils import is_address, keccak, to_checksum_address

from ..config import get_settings

CHAINS: dict[int, dict] = {
    84532: {"name": "Base Sepolia", "mainnet": False, "explorer": "https://sepolia.basescan.org"},
    31337: {"name": "Local (Hardhat)", "mainnet": False, "explorer": None},
    8453: {"name": "Base", "mainnet": True, "explorer": "https://basescan.org"},
}
TRANSFER_TOPIC = "0x" + keccak(text="Transfer(address,address,uint256)").hex()
ZERO_ADDRESS = "0x" + "0" * 40
USDC_DECIMALS = 6
# One cent of USDC in its smallest unit.
USDC_UNITS_PER_CENT = 10 ** (USDC_DECIMALS - 2)

_ids = itertools.count(1)


class ChainError(Exception):
    """The RPC endpoint is missing, unreachable or returned an error."""


def norm(address: str) -> str:
    """Checksummed address, or ValueError."""
    if not isinstance(address, str) or not is_address(address):
        raise ValueError("Not a valid wallet address.")
    return to_checksum_address(address)


def topic_address(address: str) -> str:
    return "0x" + "0" * 24 + address.lower().removeprefix("0x")


def address_from_topic(topic: str) -> str:
    return to_checksum_address("0x" + topic[-40:])


def selector(signature: str) -> bytes:
    return keccak(text=signature)[:4]


def calldata(signature: str, args: list) -> str:
    """ABI-encode a call. `signature` is e.g. "mint(address,uint256)"."""
    types = signature[signature.index("(") + 1:-1]
    type_list = [t for t in types.split(",") if t]
    return "0x" + (selector(signature) + encode(type_list, args)).hex()


async def rpc(method: str, params: list):
    url = get_settings().token_rpc_url
    if not url:
        raise ChainError("TOKEN_RPC_URL is not set.")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(url, json={"jsonrpc": "2.0", "id": next(_ids), "method": method, "params": params})
            res.raise_for_status()
            body = res.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ChainError(f"RPC request failed: {type(exc).__name__}") from exc
    if body.get("error"):
        raise ChainError(f"RPC error: {body['error'].get('message', 'unknown')}")
    return body.get("result")


async def block_number() -> int:
    return int(await rpc("eth_blockNumber", []), 16)


async def get_logs(address: str, topics: list, from_block: int, to_block: int) -> list[dict]:
    return await rpc("eth_getLogs", [{"address": address, "topics": topics,
                                      "fromBlock": hex(from_block), "toBlock": hex(to_block)}]) or []


async def call(to: str, signature: str, args: list, out_types: list[str], block: int | None = None):
    """eth_call at `block` (default latest), decoded to `out_types`."""
    raw = await rpc("eth_call", [{"to": to, "data": calldata(signature, args)},
                                 hex(block) if block is not None else "latest"])
    data = bytes.fromhex((raw or "0x")[2:])
    if not data:
        raise ChainError(f"Empty result from {signature}; is the contract deployed on this chain?")
    values = decode(out_types, data)
    return values[0] if len(values) == 1 else values
