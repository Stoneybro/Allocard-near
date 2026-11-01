#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONTRACTS_DIR="${WORKSPACE_ROOT}/packages/contracts"

if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
fi

bash "${SCRIPT_DIR}/contracts-build.sh"

echo "Running Rust tests for Allocard contracts..."
cd "${CONTRACTS_DIR}"
cargo test --workspace

