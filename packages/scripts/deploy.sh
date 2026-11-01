#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
WASM_PATH="${WORKSPACE_ROOT}/packages/contracts/res/allocard_treasury.wasm"

NEAR_NETWORK="${NEAR_NETWORK:-testnet}"
TREASURY_ACCOUNT_ID="${TREASURY_ACCOUNT_ID:-}"
OWNER_ACCOUNT_ID="${OWNER_ACCOUNT_ID:-}"

echo "================================================================================"
echo "  Allocard Treasury Deployment Script"
echo "  Network: ${NEAR_NETWORK}"
echo "================================================================================"

if [ -z "${TREASURY_ACCOUNT_ID}" ] || [ -z "${OWNER_ACCOUNT_ID}" ]; then
  echo "Usage: TREASURY_ACCOUNT_ID=<account.testnet> OWNER_ACCOUNT_ID=<owner.testnet> ./deploy.sh"
  echo ""
  echo "Example:"
  echo "  TREASURY_ACCOUNT_ID=my-treasury.testnet OWNER_ACCOUNT_ID=my-owner.testnet ./deploy.sh"
  exit 1
fi

if [ ! -f "${WASM_PATH}" ]; then
  echo "Wasm artifact not found. Building..."
  bash "${SCRIPT_DIR}/contracts-build.sh"
fi

echo "[1/2] Deploying ${WASM_PATH} to ${TREASURY_ACCOUNT_ID} on ${NEAR_NETWORK}..."
if command -v near >/dev/null 2>&1; then
  near deploy "${TREASURY_ACCOUNT_ID}" "${WASM_PATH}" \
    --networkId "${NEAR_NETWORK}"

  echo "[2/2] Initializing Allocard Treasury..."
  near call "${TREASURY_ACCOUNT_ID}" new \
    "{\"config\": {\"network_domain\": \"near:${NEAR_NETWORK}\", \"owner\": \"${OWNER_ACCOUNT_ID}\"}}" \
    --accountId "${OWNER_ACCOUNT_ID}" \
    --networkId "${NEAR_NETWORK}"
else
  echo "[!] 'near' CLI is not installed in PATH."
  echo "To deploy manually using near-cli or near-cli-rs, run:"
  echo "  near deploy ${TREASURY_ACCOUNT_ID} ${WASM_PATH} --networkId ${NEAR_NETWORK}"
  echo "  near call ${TREASURY_ACCOUNT_ID} new '{\"config\": {\"network_domain\": \"near:${NEAR_NETWORK}\", \"owner\": \"${OWNER_ACCOUNT_ID}\"}}' --accountId ${OWNER_ACCOUNT_ID} --networkId ${NEAR_NETWORK}"
fi

echo "Deployment workflow completed."
