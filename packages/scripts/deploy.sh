#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
export WASM_PATH="${WORKSPACE_ROOT}/packages/contracts/res/allocard_treasury.wasm"
# Always deploy an artifact built from the current checkout.
bash "${SCRIPT_DIR}/contracts-build.sh"
node --input-type=module -e 'import(process.argv[1]).then(m => m.deploy()).catch(() => { console.error("Deployment failed. Check configuration and RPC outcome before retrying."); process.exitCode = 1; })' \
  "${WORKSPACE_ROOT}/packages/delegation-sdk/scripts/deploy.mjs"
