#!/usr/bin/env bash
# End-to-end check of the token program on a local Hardhat node: deploys the
# real T-REX suite, then runs backend/tests/test_token_e2e.py, which drives the
# backend API and executes each Safe proposal from a stand-in Safe account.
#
#   cd contracts && npm ci && ./scripts/e2e-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8545
RPC="http://127.0.0.1:${PORT}"
LOG="$(mktemp)"

if curl -s -o /dev/null -X POST -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC"; then
  echo "Something is already listening on ${RPC}; stop it first." >&2
  exit 1
fi

npx hardhat node --port "$PORT" >"$LOG" 2>&1 &
NODE_PID=$!
trap 'kill "$NODE_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC" && break
  sleep 0.5
done

# Hardhat account #1 stands in for the Safe (an EOA, hence ALLOW_SAFE_WITHOUT_CODE).
SAFE_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 ALLOW_SAFE_WITHOUT_CODE=true ALLOWED_COUNTRIES=840 \
  npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/deploy-mock-usdc.js --network localhost

cd ../backend
TOKEN_E2E_RPC_URL="$RPC" TOKEN_E2E_DEPLOYMENT="../contracts/deployments/localhost.json" \
  python3 -m pytest -q -p no:warnings tests/test_token_e2e.py "$@"
