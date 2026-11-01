# Allocard Delegation Foundation

> **Autonomous Corporate Treasury & Hierarchical Delegation Engine on Native NEAR Protocol**

Allocard provides an onchain treasury and authority delegation infrastructure built directly on native NEAR. It enables corporate treasuries, DAOs, and automated AI agents to execute budgetary transfers through cryptographically bounded, non-monotonic permissions without giving delegates direct access to root private keys or unconstrained spending authority.

---

## 1. Architecture & Security Invariants

Allocard is built as a **Single Treasury Contract** model on NEAR, enforcing all financial, policy, and reservation constraints within atomic receipt boundaries:

```
                          ┌───────────────────────────┐
                          │   Treasury Owner (Root)   │
                          └─────────────┬─────────────┘
                                        │ (Depth 0)
                                        ▼
                          ┌───────────────────────────┐
                          │   Finance Manager (L1)    │  Lifetime: 10 NEAR
                          └─────────────┬─────────────┘
                                        │ (Depth 1)
                                        ▼
                          ┌───────────────────────────┐
                          │   AI Travel Agent (L2)    │  Lifetime: 2 NEAR (Strict Recipient)
                          └─────────────┬─────────────┘
                                        │ (Execute Action)
                                        ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │                        Allocard Treasury Contract                      │
    │  1. Check Preflight (Epoch, Expiry, Revocation, Principal Blocks)      │
    │  2. Pure Policy Path Evaluation (Ancestry, Ceilings, MetaMask Caps)    │
    │  3. Lock Reservations (Usage.pending += amount)                       │
    │  4. Debit Available Liquidity & Increment Pending Outgoing             │
    │  5. Dispatch External Transfer (NearToken::transfer or ft_transfer)   │
    │  6. Private Callback (on_transfer_result):                             │
    │     - Success: pending -> settled, debit pending_outgoing              │
    │     - Failure: release pending, restore principal to available         │
    └────────────────────────────────────────────────────────────────────────┘
```

### Key Security Invariants
1. **Permission Terminology**: All authority records are strictly termed **Permissions** (formerly "Grants"). A permission confers authority to spend up to configured budgets; it does not transfer custody of underlying tokens.
2. **Two-Phase Atomic Dispatch**: Budget reservations across **all ancestors** in the delegation chain and ledger debiting occur synchronously in the originating receipt *before* any promise is scheduled.
3. **Private Settlement Callback**: The `on_transfer_result` method is strictly `#[private]`, verified by NEAR runtime predecessor checks (`predecessor == current_account_id`). External callers cannot forge or manipulate execution outcomes.
4. **Ancestry & Non-Monotonic Narrowing**: Child permissions must strictly equal or narrow their parent terms (ceilings, lifetime budgets, execution counts, recipient allowlists, and duration). Siblings independently consume their shared parent's capacity.
5. **Replay Protection**: Versioned Borsh envelopes (`ALLOCARD_EXECUTE_V1`, `ALLOCARD_OWNER_WITHDRAW_V1`) bind domain, network domain, contract ID, actor, request ID, permission ID, action, and deadline. Replaying identical requests is idempotent; conflicting payloads are rejected with `ALLOCARD_REQUEST_ID_CONFLICT`.
6. **O(1) Invalidation & 2-Step Handover**: The owner can invalidate all outstanding permissions in O(1) by advancing `authority_epoch`. Ownership handover requires explicit nominee acceptance.

---

## 2. Monorepo Structure

```
Allocard/
├── apps/
│   └── web/                   # Next.js 16 (App Router, Turbopack, Tailwind CSS v4)
├── packages/
│   ├── contracts/
│   │   ├── res/               # Compiled allocard_treasury.wasm (775 KB)
│   │   └── treasury/          # Rust NEAR Smart Contract (near-sdk 5.30.0)
│   ├── delegation-sdk/        # Local TypeScript SDK (near-api-js, @noble/hashes)
│   └── scripts/               # Automation, compilation, deployment & CLI demo
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

## 3. Verified Commands

All commands are verified and runnable from the repository root:

### Contract Compilation & Testing
```bash
# Compile Rust treasury contract to optimized Wasm:
pnpm run contracts:build

# Run all 24 contract unit tests + 3 sandbox integration tests:
pnpm run contracts:test
```

### TypeScript SDK Build & Vitest Tests
```bash
# Build TypeScript SDK (CommonJS, ESM, and TypeScript declarations):
pnpm run sdk:build

# Run vitest test suite (canonical hashing, client mocks, request IDs):
pnpm run sdk:test
```

### Independent CLI Demonstration
```bash
# Run standalone CLI demo verifying request IDs and canonical Borsh envelopes:
pnpm run demo
```

### Next.js Web Application
```bash
# Run Next.js web application in development mode:
pnpm run web:dev

# Build production optimized Next.js app:
pnpm run web:build
```

### Full Repository Pre-flight Check
```bash
# Validates SDK build, SDK unit tests, and Next.js production build:
pnpm run delegation:check
```

---

## 4. Measured Gas Limits (NEAR Sandbox Integration)

Sandbox measurements executed with `near-workspaces` across a 3-depth delegation hierarchy (`Root -> L1 -> L2 -> Leaf`):

| Operation | Measured Gas Burnt | Configured Allocation | Status |
|---|---|---|---|
| **3-Level Delegated Execution** | **8,477,663,094,096 Gas (8.48 TGas)** | 20 TGas (Transfer) + 30 TGas (Callback) | Well within limit |
| **Private Settlement Callback** | ~2.5 TGas | 30 TGas | Well within limit |
| **Root Permission Creation** | ~3.8 TGas | 40 TGas | Well within limit |
| **Child Permission Creation** | ~4.2 TGas | 40 TGas | Well within limit |

---

## 5. Canonical Test Vectors

Both the Rust contract (`allocard-treasury`) and TypeScript SDK (`@allocard/delegation-sdk`) produce the identical canonical SHA-256 request hash:

```json
{
  "network_domain": "near:mainnet",
  "contract_id": "treasury.allocard.near",
  "actor": "employee.near",
  "request": {
    "api_version": 1,
    "request_id": "a000000000000000000000000000000000000000000000000000000000000001",
    "permission_id": "42",
    "action": {
      "type": "Transfer",
      "asset": { "type": "NativeNear" },
      "receiver": "vendor.near",
      "amount": "1000000000000000000000000"
    },
    "deadline_ms": "1700000000000"
  }
}
```

**Canonical SHA-256 Hash**:
```
1349d7047d8f44b5f5ea2ec182812d3aa0f40363d5add7e9dae19ac7e0b1ecd6
```

---

## 6. Standard Error Codes

All contract panics use the stable `ALLOCARD_*` error prefix:

| Error Code | Meaning |
|---|---|
| `ALLOCARD_UNAUTHORIZED` | Caller does not hold permission or is not authorized |
| `ALLOCARD_PAUSED` | Treasury operations are paused by owner |
| `ALLOCARD_PRINCIPAL_BLOCKED` | Caller or ancestor principal is on the blocklist |
| `ALLOCARD_INVALID_INPUT` | Malformed parameters, zero amounts, or non-zero deposit on 0-deposit method |
| `ALLOCARD_PERMISSION_NOT_FOUND` | Permission ID does not exist |
| `ALLOCARD_PERMISSION_REVOKED` | Permission or ancestor permission has been revoked |
| `ALLOCARD_STALE_EPOCH` | Permission was issued in a previous authority epoch |
| `ALLOCARD_MAX_DEPTH` | Hierarchy depth exceeds configured maximum (8) |
| `ALLOCARD_CHILD_PERMISSION_EXPANSION` | Child permission attempts to expand parent terms |
| `ALLOCARD_RECIPIENT_NOT_ALLOWED` | Recipient is not in the strict allowlist |
| `ALLOCARD_PER_ACTION_LIMIT` | Transfer amount exceeds single-action ceiling or floor |
| `ALLOCARD_LIFETIME_LIMIT` | Transfer amount exceeds cumulative lifetime allowance |
| `ALLOCARD_WINDOW_LIMIT` | Transfer amount exceeds recurring fixed window allowance |
| `ALLOCARD_STREAMING_LIMIT` | Transfer amount exceeds dynamically accrued linear allowance |
| `ALLOCARD_EXECUTION_COUNT_EXCEEDED`| Permission has reached maximum executions count |
| `ALLOCARD_APPROVAL_REQUIRED` | Transfer amount requires approver authorization |
| `ALLOCARD_APPROVAL_EXPIRED` | Recorded approval has expired |
| `ALLOCARD_DEADLINE_EXPIRED` | Execution deadline has passed |
| `ALLOCARD_REQUEST_ID_CONFLICT` | Same actor and request ID submitted with different payload |
| `ALLOCARD_INSUFFICIENT_AVAILABLE_FUNDS` | Treasury lacks spendable liquidity or operating reserve |
| `ALLOCARD_INVALID_CALLBACK` | Callback receipt count was not 1 or caller is not contract itself |

---

## 7. Known Limitations (v1)

1. **Direct Transfers to Treasury**: Native transfers sent via bare transfers (without calling `deposit_native`) or unsupported FT tokens sent without `ft_on_transfer` are treated as unallocated surplus and are not credited to employee spendable allowances.
2. **Calendar-Month Semantics**: Fixed windows are half-open fixed-duration intervals (`now_ms - anchor_ms) / duration_ms`). Variable calendar month lengths (28–31 days) require a subsequent policy version.
3. **No Unsafe In-Flight Upgrades**: The v1 contract does not contain dynamic code execution or proxy delegate call endpoints that could bypass asset accounting.
