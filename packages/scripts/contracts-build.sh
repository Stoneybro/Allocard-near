#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONTRACTS_DIR="${WORKSPACE_ROOT}/packages/contracts"

if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env"
fi

echo "Building Allocard treasury contract to Wasm..."
cd "${CONTRACTS_DIR}"
cargo build --target wasm32-unknown-unknown --release -p allocard-treasury -p allocard-factory

mkdir -p "${WORKSPACE_ROOT}/packages/contracts/res"
cp "${CONTRACTS_DIR}/target/wasm32-unknown-unknown/release/allocard_treasury.wasm" "${WORKSPACE_ROOT}/packages/contracts/res/"
echo "Wasm artifact created at packages/contracts/res/allocard_treasury.wasm"


cp "${CONTRACTS_DIR}/target/wasm32-unknown-unknown/release/allocard_factory.wasm" "${WORKSPACE_ROOT}/packages/contracts/res/"

cargo build --target wasm32-unknown-unknown --release -p allocard-shared
cargo rustc --target wasm32-unknown-unknown --release -p allocard-mock-usdc -- -C strip=symbols
cp "${CONTRACTS_DIR}/target/wasm32-unknown-unknown/release/allocard_shared.wasm" "${WORKSPACE_ROOT}/packages/contracts/res/"
