# Allocard delegation foundation — implementation specification

Version: 1.1 proposal  
Date: 1 November 2026  
Target: native NEAR contracts written in Rust  
Status: implementation contract for an AI coding agent; not implemented or audited

## 1. Purpose and binding decisions

Build a reusable permission system that lets an asset-owning treasury authorize other principals to perform bounded actions without transferring unused allowances to them. Principals may create narrower child grants when permitted. The foundation must support company → manager → employee → agent authority paths without containing employee, company-department, vendor-category or AI-specific logic.

MUST and MUST NOT are acceptance requirements. SHOULD permits a documented engineering choice.

Binding decisions:

- One treasury contract per organization; authority, policy evaluation, reservations and dispatch preparation execute in that same contract.
- One authenticated owner account initially. No mandatory multisig, DAO, TEE, external signing service, oracle or cross-chain intermediary.
- Native NEAR account IDs are the initial principals. Email is an application identifier, not contract authority.
- Grants are stored onchain and their terms are immutable. Revoke and create replacements instead of editing permissions.
- A grant has one parent or is a root grant. Multiple roots and multiple grants per principal are allowed.
- Every execution selects one leaf grant. It must satisfy every ancestor independently. Authority from different branches cannot be combined.
- Child grants draw from shared ancestor capacity; grant creation does not reserve cash or budget.
- Direct NEAR and allowlisted NEP-141 token transfers are the first executors. Extensibility is through explicit action/executor interfaces, not arbitrary contract calls.
- All amounts are integers in an asset's smallest unit; no floating-point arithmetic or implicit exchange rates.
- Onchain spending remains usable without sponsor APIs. Login or RPC availability may still affect a particular client.

## 2. Deliverables and scope

Implement inside the user's current monorepo, which contains a Next.js application and a Rust workspace/folder/package. Deliver the treasury Wasm, integration tests, a local TypeScript SDK package and deployment scripts within that monorepo. A factory is optional deployment tooling, not part of authorization.

The old Allocard repository is NOT present in this workspace. This is a fresh native-NEAR implementation from this specification, not a migration of accessible MetaMask code. The agent MUST NOT assume access to the old repository, import unavailable files, reconstruct its schema as fact, or block implementation waiting for it. Do not clone or fetch that repository unless the user separately authorizes it. The product context in this document is sufficient to implement the engine.

### 2.1 Monorepo integration contract

First inspect only the actual current checkout: repository instructions, root package manifest, JS workspace configuration/lockfile, Next.js app, existing Cargo manifests, toolchain files and CI. Use the existing names, paths and package manager. Preserve unrelated code. Paths below are a REFERENCE layout if equivalent structure does not already exist:

    /
      apps/
        web/                         # existing Next.js app
      packages/
        contracts/
          Cargo.toml                 # Rust workspace manifest
          Cargo.lock
          rust-toolchain.toml
          treasury/
            Cargo.toml               # deployable Rust crate
            src/
            tests/
        delegation-sdk/
          package.json               # private local TypeScript package
          src/
          tests/
        scripts/                     # build, deploy, verify and smoke scripts
      docs/
        delegation/                  # spec, trust model, API and deployment notes

If the Next.js app is at the root, keep it there. If Rust already lives under packages/contracts or another folder, keep that location. Do not create a second Rust workspace, move the application, introduce a second JS lockfile, or add Turborepo/Nx just to match the example.

The Rust workspace is built by Cargo, not npm/pnpm. It need not be an npm workspace package. A private package.json wrapper is optional only when the existing task runner benefits from it. The SDK is a local JS workspace dependency; publishing it to npm is not required.

Provide root-level commands with the following meanings, adapted to the actual package manager:

| Command | Responsibility |
|---|---|
| contracts:build | Build the Rust treasury to Wasm using its actual manifest path |
| contracts:test | Rust unit/property tests and documented sandbox suite |
| sdk:build | Build/typecheck the local TypeScript SDK |
| sdk:test | SDK serialization, hashes and adapter tests |
| delegation:check | Run foundation checks, SDK checks and relevant Next.js type/build checks |

Scripts must use actual manifest paths and the correct Rust target directory; do not assume root target/ when Cargo builds under packages/contracts/. Keep generated Wasm out of web public/ and browser imports. Supply a versioned JSON/interface schema or explicitly maintained DTO mapping plus cross-language fixtures. If code generation is introduced, document and test its command.

### 2.2 Next.js / SDK boundary

Next.js owns pages, invitation UX, policy previews, login integration and payment status display. The Rust contract owns every authoritative grant, budget and execution decision.

The local SDK owns contract DTOs, exact request serialization, canonical hashes, RPC calls, events/error decoding and signer interfaces. Its core must be usable from a browser or Node process without importing Next.js. Separate optional browser signing bindings from server-only utilities. Represent large integer values as decimal strings at JSON boundaries and bigint/validated integer helpers internally; do not let JavaScript Number silently round amounts.

Pass a signer implementation into SDK mutations; do not couple the SDK to a single wallet vendor. Reads may use public RPC. A Next.js Route Handler or Server Action may assist with invitations, previews, AI calls or relaying, but the user's authenticated onchain request is still required for mutations. An application login session alone is not a treasury signature.

Provider API secrets, relayer credentials and deployment keys belong in server-only environment variables or deployment tooling, never NEXT_PUBLIC_* or client bundles. Contract IDs, network IDs and public RPC URLs may be public. The normal application server MUST NOT retain a treasury full-access key. An optional relayer key pays gas; it does not become a treasury administrator.

The database may mirror onchain IDs and statuses and hold private names/invoices. It cannot increase allowances, declare a transfer successful onchain or replace a missing callback. No new database or indexer is a prerequisite for the engine's sandbox/CLI tests. Use the application's existing storage when product integration requires it.

CI must check the Rust workspace, SDK and its Next.js integration as separate jobs or steps. Do not require a UI development server or live sponsor account to run core contract tests.

Required foundation capabilities:

1. Root grants, child grants and bounded ancestry validation.
2. Explicit asset permissions, recipient rules, time rules, per-action limits, lifetime limits and recurring fixed-window limits.
3. Optional single-account approval requirements attached to policies.
4. Strict shared budget reservations under concurrent requests.
5. Ancestor-aware revocation, account blocking, global invalidation and pause.
6. Token/native deposits, supported transfers, execution records and callbacks.
7. Previews, stable error codes, versioned events and SDK examples.
8. Ownership handover and a documented deployment/recovery trust model.

Not implemented in v1: reserved employee allocations, arbitrary function calls, token transfer_call execution, swaps, cross-chain settlement, yield, external policy contracts, rolling windows, monthly calendar rules, USD-valued multiasset limits, private onchain accounting, offchain signed grants, custom wallet-signature verification, agent hosting, self-service upgrades or mandatory multisig. These are extension areas, not fake enum variants advertised as working.

## 3. System boundaries

| Part | Owns | Must not own |
|---|---|---|
| Client and application backend | Invitations, labels, policy builder, AI suggestions, reporting | Permission to bypass contract validation |
| Authentication provider / wallet | User login, credential management and signing | Budget or ancestry decisions |
| Relayer | Submission and gas sponsorship of authenticated transactions | Choosing a different actor or action |
| Treasury contract | Assets, grants, budgets, replay protection, execution and settlement | Email verification, natural-language interpretation |
| External token contract | NEP-141 balance and transfer implementation | Allocard grant authority |
| Indexer | Searchable derived history | Authoritative balances or limits |

Use modules within one initial Rust contract: types, authority, policy, accounting, assets, execution, admin, events, errors and views. Extract crates only when stable interfaces justify it.

## 4. NEAR assumptions and trust boundaries

NEAR external calls are asynchronous and independent. A successful originating receipt is not evidence that a transfer succeeded, and failure of an external receipt does not roll back earlier state. Callbacks MUST be private. See sources S1–S2.

Authenticate account-based calls with predecessor_account_id. Do not authorize using signer_account_id alone, a caller-supplied actor, an email or a backend assertion. An ordinary forwarding contract is the caller and must have its own authority. NEP-366 protocol-relayed calls may preserve the originating account at the target; prove this behavior with a test rather than special-casing an arbitrary relayer account.

Native function-call keys can improve sessions, but cannot replace the grant model. Their allowance concerns gas and they cannot attach NEAR. The public execute endpoint therefore accepts zero deposit; treasury operating funds pay required token-transfer marker deposits. See S3–S4.

Token integration assumes audited/accepted, standards-compliant token contracts. An owner can allowlist a malicious token, but must not thereby gain an ability to corrupt other assets' accounting. Never interpret a token symbol as an asset identity.

## 5. Data model

The following are semantic schemas. The agent must supply complete near-sdk serialization and storage representations. Use Borsh for state, versioned JSON for public APIs, U128 for external amounts and decimal strings for u64 IDs/timestamps. Times are milliseconds derived from block_timestamp, never client clocks.

### 5.1 Configuration

    TreasuryConfig {
      schema_version: u16,
      network_domain: String,          // fixed at initialization; verified in deployment
      owner: AccountId,
      pending_owner: Option<AccountId>,
      authority_epoch: u64,
      paused: bool,
      next_grant_id: u64,
      next_execution_id: u64,
      max_total_grants: u32,           // initial default 1,024; no silent auto-growth
      max_pending_executions: u32,     // initial default 64
      min_operating_reserve: u128,
      callback_gas: Gas,
      transfer_gas: Gas,
      storage_funding_remaining: u128,
      operating_budget_remaining: u128,
      pending_execution_count: u32
    }

Hard schema bounds: maximum 8 grants in a path (root depth 0, leaf depth <= 7); 16 asset permissions per grant; 64 recipients per permission; 8 KiB serialized execute/create-grant inputs. Reject oversized inputs before expensive processing. Gas allocations and the pending limit require sandbox validation at maximum path length. Do not claim throughput from these defaults.

### 5.2 Assets and action permissions

    AssetId = NativeNear | Nep141 { contract_id: AccountId }

    AssetPermission {
      asset: AssetId,
      recipients: Any | Only(Vec<AccountId>),
      max_per_action: Option<u128>,
      lifetime_limit: Option<u128>,
      fixed_window: Option<FixedWindowLimit>,
      approval: Option<ApprovalRule>,
      acknowledge_unbounded_budget: bool
    }

    FixedWindowLimit {
      limit: u128,
      duration_ms: u64,
      anchor_ms: u64
    }

    ApprovalRule {
      approver: AccountId,
      above_amount: u128             // approval required when amount > threshold
    }

Every permission represents a direct transfer of that asset in v1. No permission means no authority for that asset. Duplicate asset entries and duplicate recipient entries are rejected. Only([]) is rejected rather than ambiguously interpreted.

Amounts, caps and window duration must be positive. A grant must have at least one permission. Finite expires_at must exceed valid_from. Root redelegation_depth must fit the hard path bound. If both lifetime_limit and fixed_window are absent, acknowledge_unbounded_budget MUST be true. This is an explicit unbounded cumulative allowance, possibly still restricted by per-action/recipient/ancestor rules; the SDK must display it. A per-action cap alone does not bound cumulative spending.

Budget windows are half-open intervals. For t >= anchor:

    window_index = (t - anchor_ms) / duration_ms

Before anchor the permission is unavailable. A 30-day window is not a calendar month. The UI must not label it monthly. Calendar-month semantics require a later policy version.

### 5.3 Grant

    Grant {
      id: GrantId,
      parent_id: Option<GrantId>,
      issuer: AccountId,
      delegate: AccountId,
      epoch: u64,
      depth: u8,
      valid_from_ms: u64,
      expires_at_ms: Option<u64>,    // exclusive; None = no local expiry
      permissions: Vec<AssetPermission>,
      redelegation_depth: u8,       // 0 means may not create children
      revoked: bool,
      metadata_hash: Option<[u8;32]>
    }

IDs are monotonically allocated and never reused. Reject self-delegation (issuer == delegate). No employee names, email addresses or plaintext invoice content in grants. Onchain recipients, values and usage are public.

Roots have parent None, depth 0 and issuer == current owner. They capture the current epoch. Children are issued only by the parent delegate, are in the same epoch, and have depth parent.depth + 1. The immutable parent link and monotonically allocated IDs prevent graph cycles.

Child constraints at creation:

- Parent path is currently active; issuer is not blocked; treasury is unpaused.
- Parent redelegation_depth > 0.
- Child redelegation_depth <= parent.redelegation_depth - 1.
- Total path remains within the hard depth bound.
- Child valid_from is >= parent's valid_from; finite parent expiry bounds child expiry (child must then be finite).
- Child assets are a subset of parent's assets.
- If parent has Only recipients, child also uses Only and is a subset.
- If parent has max_per_action, child supplies a cap <= it.
- If parent has lifetime_limit, child supplies a lifetime cap <= it.
- Fixed-window definitions may differ; always enforce every ancestor's own buckets. Do not incorrectly compare numeric limits with different durations.
- Parent approval policies remain inherited even if the child adds none.

These checks improve configuration clarity. Full path evaluation at execution remains the security boundary; no local child check substitutes for it.

### 5.4 Usage

    BudgetKey {
      grant_id: GrantId,
      asset: AssetId,
      scope: Lifetime | FixedWindow { window_index: u64 }
    }

    Usage { settled: u128, pending: u128 }

Each applicable lifetime/window counter is separate. A grant can have both; both must pass. All checks use checked arithmetic:

    settled + pending + amount <= limit

A limit belongs to a particular grant, not to a principal or child wallet. Siblings share their parent's counters. Multiple roots have separate counters but share treasury liquidity. No historical grant/counter/request deletion in v1; state growth is funded and observable.

### 5.5 Treasury accounting

    AssetLedger { available: u128, pending_outgoing: u128 }

Available is credited only by authenticated deposit flows or confirmed restoration after a failed outgoing transfer. Grant creation never changes it. Outgoing dispatch subtracts available and adds pending_outgoing. Success subtracts pending_outgoing. Proven transfer failure subtracts pending_outgoing and restores available.

Do not credit arbitrary direct FT transfers, a client balance assertion or an unauthenticated balance-sync request. Unsupported direct deposits are not automatically recoverable in v1.

Native spendable capital must be separated from storage funding and operating reserve. Before each native dispatch, also check current actual unlocked native balance less storage requirement, all pending native commitments and the protected operating floor. A ledger entry never overrides physical solvency.

The operating pool covers token-transfer marker deposits and contract overhead, not employee budget. Any returned marker deposits may remain unallocated surplus; do not double-credit employee principal.

Resource bookkeeping is explicit: top_up_storage increases storage_funding_remaining; preflight charges actual new persistent bytes at the runtime storage cost and reserves the maximum later growth of the record before any external transfer. top_up_operating increases operating_budget_remaining; marker deposits debit it at dispatch and are conservatively not restored automatically. Unallocated refunds/surplus are excluded from principal and may be recognized only by a separately specified maintenance mechanism (not implemented in v1). Actual native solvency is an additional bound on these bookkeeping pools, including the configured operating floor. Define and test checked helpers that partition principal, funded storage, pending commitments and operating capacity without counting the same NEAR twice. Existing deployed code/account storage must be funded at initialization.

### 5.6 Execution and replay identity

    Action = Transfer { asset: AssetId, receiver: AccountId, amount: u128 }

    ExecuteRequest {
      api_version: u16,
      request_id: [u8;32],
      grant_id: GrantId,
      action: Action,
      deadline_ms: u64
    }

    Execution {
      id: ExecutionId,
      actor: AccountId,
      request_id: [u8;32],
      request_hash: [u8;32],
      authority_mode: Delegated | OwnerWithdrawal,
      grant_id: Option<GrantId>,    // Some for delegated execution; None for owner withdrawal
      epoch: u64,
      action: Action,
      created_at_ms: u64,
      status: Pending | Succeeded | Failed,
      needs_reconciliation: bool,
      reservations: Vec<Reservation>,
      failure_code: Option<ErrorCode>
    }

    Reservation { budget_key: BudgetKey, amount: u128 }

Persist the exact reservation keys, including original window indexes. Settlement MUST NOT recompute windows from callback time. Persist a replay map keyed by (actor, request_id). Never reuse or delete entries in v1.

Hash a versioned Borsh request envelope containing a fixed Allocard domain, network_domain, current_account_id, actor and the complete request. Never hash ad hoc JSON. Include an SDK/contract shared test vector.

The immutable grant_id identifies its captured epoch. For owner-withdrawal envelopes, include an explicit authority_epoch supplied by the caller and checked against current config for new dispatch. Do not derive replay hashes from mutable configuration on a retry; the exact originally submitted envelope must remain hashable after an ownership change.

Repeated execute with identical actor/request_id/hash returns the existing execution ID and never redispatches. The same actor/request_id with another hash is rejected. A failed execution requires a new request ID for a deliberate retry. The request_id format at the JSON boundary is exactly 64 lowercase hex characters.

## 6. Administration and authority lifecycle

Owner operations: create roots, revoke any grant, block/unblock principals, pause/unpause, invalidate all grants, enable/disable new transfers for an asset, top up storage/operating funds, withdraw available treasury capital, and initiate ownership handover.

The owner cannot impersonate a delegate to execute through that delegate's grant. Owner withdrawals use a separate authenticated action and the same execution/reservation machinery for treasury liquidity; they do not consume employee counters.

Revocation: owner, a grant's issuer, or a strict ancestor delegate can revoke that grant. A delegate may surrender its own grant. Check the stored ancestry to determine that relationship; a sibling is never an ancestor. Revocation is idempotent. It is allowed while paused or expired. Blocking a principal does not prevent that principal surrendering its own grant.

Every active-path check rejects revoked grants, old epochs, blocked delegates and blocked issuers. Blocking an ancestor thereby disables descendants. Check the current owner against the blocklist as well, so blocking the owner is rejected; ownership transfer to a blocked account is rejected.

invalidate_all increments authority_epoch in O(1). Pending executions remain accounted under their saved reservations.

pause blocks new roots, child creation, delegate execution and owner withdrawals. It permits deposits, revocation, blocking, ownership handover, global invalidation and callbacks. Approvals may be recorded while paused but cannot cause execution.

Ownership handover is two-step: current owner nominates, nominee accepts; owner may cancel. Accepting increments authority_epoch, invalidates outstanding approval authority, and changes owner. All old grants are disabled; new owner explicitly creates replacements. Pending transfers settle normally. An external multisig contract may later be the owner if it can call these methods; no multisig SDK is required.

Revocation/expiry/blocking/pause only prevent new dispatches once processed. They do not promise to cancel external actions already dispatched. Callback settlement must succeed regardless of later grant state.

## 7. Authorization algorithm

execute MUST perform the following within one originating receipt:

1. Validate API version and bounded serialization sufficiently to safely parse the request.
2. Set actor from predecessor. Compute the immutable envelope hash. Apply replay handling first: identical already-recorded requests return their execution ID even after deadline, revocation, pause or epoch change; conflicting hashes fail. This is a read of prior execution, not renewed authorization.
3. For a NEW request validate amount > 0, deadline (now < deadline), and treasury != recipient. Reject unsupported action/asset types.
4. Require treasury unpaused, actor unblocked, and leaf.delegate == actor.
5. Load leaf-to-root ancestry within maximum depth; verify stored links, issuer/delegate continuity, depth, current epoch, valid_from <= now < expiry (where finite), and all block/revocation states. Any corrupted path fails closed.
6. For each grant, find the matching asset permission; reject absent assets, disallowed recipients, per-action excess or unavailable window.
7. Build all applicable lifetime/window BudgetKeys. Check every counter using settled + pending + amount.
8. Verify required approvals from each applicable ancestor policy, bound to the exact request hash.
9. Check asset is enabled and trusted for new dispatch. Check available treasury funds, operating/storage capacity, maximum pending count and sufficient prepaid gas for transfer plus callback.
10. Preallocate execution/replay/usage storage and bound callback writes. Reserve all counters, debit available and increment pending_outgoing. Consume required approvals and store Pending execution/replay mapping.
11. Emit execution_dispatched and schedule exactly one external transfer with a private callback.

All mutations through step 10 must either all commit or all revert, together with scheduling step 11 in the originating receipt. Never send funds before recording all reservations. Do not introduce an asynchronous external policy check between validation and reservation.

Evaluate a budget only once for each unique BudgetKey. Reject duplicate permissions at creation; do not multiply-charge duplicate rules. Each ancestor with a budget is charged even when it has the same limit as another ancestor.

preview_execute(actor, request) uses the same pure evaluation logic but makes no reservations and requires no signature. It reports policy violations, missing approvals and capacity at the observed block. It is advisory and never a token of authorization. Do not return a misleading single scalar for effective allowance across differing window systems.

## 8. Approvals

v1 supports one approver account per asset permission, not a multisig voting module. Different ancestors can require different approvers; all applicable requirements must be met.

An authenticated approver calls approve_request(actor, request). Contract computes the same hash, validates that the proposed actor is the leaf delegate and the authority path is live, and records an approval only for approval rules naming the caller. Approver must be unblocked. No funds or budgets are reserved yet.

Store each approval against (request_hash, grant_id, asset). Its expiry is the request deadline. Reject excessively long approval request deadlines (maximum 7 days). The actor, exact action, grant, treasury, epoch and network are bound by the hash/path.

Approvers may withdraw unconsumed approvals. The contract does not execute automatically when approvals arrive. The delegate subsequently calls execute; all authority and limits are rechecked. Approval cannot override a cap or a revoked grant.

Consumed approvals are never restored on transfer failure. An identical request returns the existing failed execution; a retry uses a new ID and new approvals. No approval needed when amount == above_amount. Multiple rules naming the same approver still need distinct stored rule bindings, but SDK may record them in one call.

## 9. Deposits, asset registration and dispatch

### Native NEAR

deposit_native is payable and credits attached_deposit to NativeNear.available. Top-up functions for operating/storage funds are separate and do not create spendable capital. Zero deposits are rejected.

Dispatch uses a native Transfer promise. Private callback evaluates the receipt result. A failed transfer restores only the principal amount, not an invented gas refund.

### NEP-141

Owner registers token contract IDs; tokens start disabled until explicitly enabled. Allowlist does not assert issuer safety. Disable blocks new dispatch and new accepted deposits, not settlement of pending transfers.

Implement FungibleTokenReceiver.ft_on_transfer. Accept only enabled token predecessors with valid nonzero amounts. Credit the treasury ledger and return zero unused amount. The treasury is a single owner of deposits; sender_id is attribution, not an employee balance or spending permission. A valid empty message is supported; reject unsupported message formats so the standard resolver can refund. Do not initiate further promises in the receiver.

Treasury registration with the token's storage system is a deployment/admin maintenance step. Recipient registration is not automatically funded during employee execution in v1. The client can prepare it separately; transfer to an unregistered recipient must fail safely and release reservations on confirmed failure.

Use ft_transfer, attach exactly 1 yoctoNEAR, and budget the marker from operating funds. No ft_transfer_call outgoing action in v1. The callback trusts receipt success only for accepted NEP-141 implementations. See S5–S6.

Do not implement generic token calls that can install future allowances, change treasury credentials or escape asset accounting.

## 10. Settlement and unresolved executions

on_transfer_result(execution_id) MUST be private, accept only the expected promise-result count and load the saved execution. The callback does not accept a caller-supplied success flag.

If execution is already terminal, return its result with no accounting mutation. Otherwise:

- Success: for each saved reservation, subtract pending and add settled. Subtract asset pending_outgoing. Set Succeeded.
- Proven external transfer failure: subtract pending on every saved counter without adding settled. Restore principal to asset.available and subtract asset pending_outgoing. Set Failed.
- Decrement pending-execution count exactly once, finalize existing fixed-size fields and emit a terminal event.

Reserve callback gas and required storage at dispatch. Settlement must not allocate unbounded data or depend on an owner, indexer, token price, current window, current grant state or a sponsor API.

Pending can remain unresolved if a callback cannot run. Anyone may flag an old Pending record after 10 minutes as needs_reconciliation; this flag DOES NOT release money or budget and a later callback still settles it. No timeout-based refund, retry transfer or owner-declared success/failure method in v1.

An RPC observer may identify the external outcome for operator diagnosis, but contract state must not trust a backend report. If no verifiable recovery mechanism exists, reservations stay locked. Document this limitation and provide monitoring; do not silently add an unsafe repair endpoint.

## 11. Storage, gas and anti-abuse

Use near_sdk::store collections with distinct versioned storage prefixes, bounded records and checked counters. Use no whole-treasury iteration in mutations. Owner-funded storage is acceptable initially but must be capped:

- Reject new grants at configured maximum; bound pending work and request sizes.
- Estimate and charge/reserve all new storage before dispatch, including callbacks' maximum final representation.
- Reject requests before dispatch when free storage/operating funds are inadequate.
- Require a top-up rather than borrow storage collateral from employee-spendable native capital.
- Rate-limit relayer submissions offchain; onchain financial rules remain authoritative.
- Preserve replay tombstones and grant ancestry. No pruning implementation in v1.
- Expose storage bytes, operating health and pending counts in views.

Gas values must be measured in sandbox tests for max-depth/max-policy paths. Include exact tested values and SDK version in README. Reject insufficient prepaid gas before scheduling transfers.

Owner-maintenance calls may register token storage using a tightly typed operation. They cannot expose arbitrary function_call, deploy_contract, add_key, delete_account or raw promise building to delegates. Maintenance native costs are checked against protected operating capacity and cannot spend committed principal.

## 12. Public API

Use typed argument objects and a versioned JSON schema. Mutations either return a documented success object or panic with an ALLOCARD_<CODE> prefix; execute returning an ID means dispatched/existing, not paid.

| Method | Caller | Deposit / behavior |
|---|---|---|
| new(config) | Deployment path | Initialize exactly once; explicit owner/domain |
| create_root_grant(spec) | Owner | Zero; returns GrantId |
| create_child_grant(parent_id, spec) | Parent delegate | Zero; returns GrantId |
| revoke_grant(id) | Authorized revoker | Zero; idempotent |
| set_principal_blocked(account, blocked) | Owner | Zero |
| set_paused(paused) | Owner | Zero |
| invalidate_all_grants() | Owner | Zero; advances epoch |
| nominate_owner(account), cancel_owner_nomination() | Owner | Zero |
| accept_ownership() | Nominee | Zero; advances epoch |
| register_asset(asset), set_asset_enabled(asset, enabled) | Owner | Zero; NativeNear exists at init |
| deposit_native() | Anyone | Positive payable deposit |
| top_up_operating(), top_up_storage() | Anyone | Positive payable; separate from principal |
| ft_on_transfer(sender_id, amount, msg) | Accepted FT predecessor | NEP-141 receiver interface |
| approve_request(actor, request) | Required approver | Zero |
| revoke_approval(actor, request) | Original approver | Zero; only unconsumed |
| execute(request) | Leaf delegate | Zero; idempotent ExecutionId |
| owner_withdraw(request) | Owner | Zero; versioned withdrawal envelope, same pending accounting, no grant |
| on_transfer_result(execution_id) | Self only | Private callback |
| flag_unresolved(execution_id) | Anyone | Zero; informational flag only |
| get_config(), get_asset_ledger(asset) | View | Include pending and enabled status |
| get_grant(id), get_grant_path(id) | View | Bounded |
| get_usage(grant_id, asset, window_index?) | View | Exact buckets |
| get_execution(id), get_execution_by_request(actor, request_id) | View | Authoritative execution state |
| preview_execute(actor, request) | View | Structured errors / requirements |

For owner_withdraw, use a separate hash domain/mode so a delegate request cannot be replayed as an owner withdrawal. Share the (actor, request_id) replay namespace and reject cross-mode collisions. Owner liquidity withdrawals respect pause and physical solvency. They may leave unused employee allowances unfunded; SDK must explain that.

The owner-withdraw request object includes api_version, request_id, authority_epoch, action and deadline_ms. All zero-deposit methods MUST explicitly reject attached deposits; implementing that behavior must not introduce a mandatory 1-yocto check on execute or create_child_grant, which would break ordinary function-call-key sessions.

Views must never expose an unbounded get_all method. Lists/search come from events/indexing; optional onchain pagination must have a hard page limit.

## 13. Events and errors

Emit NEP-297-style EVENT_JSON logs with standard allocard, version 1.0.0, event name and data array. Include contract/domain, IDs and actor as appropriate; use decimal strings for amounts.

Events: treasury_initialized, grant_created, grant_revoked, principal_block_changed, pause_changed, authority_epoch_changed, owner_nominated, owner_changed, asset_registered, asset_status_changed, treasury_deposit, approval_recorded, approval_revoked, execution_dispatched, execution_succeeded, execution_failed, execution_flagged.

Stable error codes at minimum:

    UNAUTHORIZED, PAUSED, PRINCIPAL_BLOCKED, INVALID_INPUT, INPUT_TOO_LARGE,
    GRANT_NOT_FOUND, GRANT_REVOKED, STALE_EPOCH, GRANT_NOT_STARTED,
    GRANT_EXPIRED, INVALID_ANCESTRY, MAX_DEPTH, REDELEGATION_DISABLED,
    CHILD_PERMISSION_EXPANSION, ASSET_NOT_ALLOWED, ASSET_DISABLED,
    RECIPIENT_NOT_ALLOWED, PER_ACTION_LIMIT, LIFETIME_LIMIT, WINDOW_LIMIT,
    APPROVAL_REQUIRED, APPROVAL_EXPIRED, DEADLINE_EXPIRED,
    REQUEST_ID_CONFLICT, INSUFFICIENT_AVAILABLE_FUNDS, OPERATING_RESERVE_LOW,
    STORAGE_RESERVE_LOW, INSUFFICIENT_GAS, PENDING_LIMIT,
    INVALID_CALLBACK, EXECUTION_NOT_FOUND, TOO_EARLY_TO_FLAG

Preview errors include offending grant ID, rule, requested amount and relevant available capacity without exposing private offchain identity data. A terminal external failure is a stored execution outcome and event, not a retroactive failure of execute.

## 14. Invariants and acceptance tests

Use unit/property tests for policy arithmetic and sandbox integration tests for receipts. Deliberately use delayed/malicious helper contracts to test boundary behavior. Tests must assert balances/counters/status, not just that calls return successfully.

Required cases:

1. Unauthorized roots, unauthorized child creation, forged actor and ordinary forwarding-contract impersonation fail.
2. A parent 1,000-unit limit shared by two 800-unit children permits only 1,000 total, regardless of request interleaving.
3. Direct parent spending and child spending consume the same parent capacity.
4. Simultaneous requests that would overspend reserve before external transfer; at most the permitted amount is dispatched.
5. Leaf, intermediate and root failures each deny execution; a sibling's allowance cannot be borrowed.
6. Every supported recipient, asset, time, per-action, lifetime and window rule is tested at its boundary.
7. Different ancestor window durations are independently enforced. Settlement after a reset mutates the original bucket, not the current one.
8. Grants cannot exceed depth or local narrowing bounds; no cycles, missing links or duplicate assets are accepted.
9. Revoking a parent, blocking an ancestor, advancing epoch and ownership acceptance block descendant dispatch without enumerating descendants.
10. Revocation/pause/expiry after dispatch do not prevent settlement or restore already spent funds.
11. Successful transfer moves all relevant pending counters to settled exactly once.
12. Proven failed FT/native transfer restores principal and releases original reservations exactly once.
13. Public callback invocation, malicious callback forwarding and arbitrary caller-supplied result flags fail.
14. Identical replay returns the existing execution, including after deadline, revocation, pause or epoch change; altered payload, mode or deadline with same ID fails; new ID is required for retry.
15. Missing callback leaves reservations locked; flagging does not refund; late callback still works.
16. Approval is exact-action/actor/grant/epoch/domain bound, threshold equality does not trigger it, and approvals never override budgets.
17. Paused treasury still accepts valid deposits and callbacks but rejects new spending.
18. FT receiver rejects unknown/disabled token contracts. Direct transfers do not create internal credits.
19. Unregistered FT recipient fails safely; no invented refund or duplicated principal.
20. Native principal cannot consume storage collateral/operating floor; marker deposits cannot drain committed principal.
21. Owner withdrawals cannot consume pending liquidity. Multiple roots share the same physical treasury balance.
22. Owner nomination requires nominee acceptance. Old grants fail after acceptance; pending executions settle.
23. Max-depth/max-policy requests and callback branches fit the documented gas/storage limits; insufficient resources fail before dispatch.
24. No sponsor API, database, UI or AI output is consulted to authorize a native action.
25. Sponsored execution works with the selected NEP-366 relayer and preserves the expected actor; an ordinary proxy does not gain this privilege.
26. Contract and SDK produce identical canonical request hashes and JSON schemas.

Monorepo integration acceptance: the existing Next.js app imports the local SDK through the repository's actual workspace setup; root scripts build/test the actual Cargo manifest and SDK; relevant app type/build checks pass; no legacy repository or external sponsor credentials are required for sandbox tests; private keys/provider secrets are absent from browser imports and NEXT_PUBLIC_* variables.

Property-test arithmetic near u128/u64 limits and random grant trees within bounds. Model failure interleavings and verify total dispatched amounts cannot exceed available funds or any applicable settled+pending budget.

## 15. Deployment, recovery and upgrades

v1 has no application-level upgrade endpoint. Deployment scripts MUST distinguish:

- Development/testnet: a retained full-access deployment key is permitted, prominently documented as a bypass that can replace code or move funds.
- Locked deployment: account is created without retained full-access keys, or deployment keys are removed after verified initialization. Owner control then goes through contract methods. No claim of production readiness before review.

Do not silently retain an Allocard-controlled treasury key. Verify deployed code hash, owner, keys, network/domain, storage/operating funding and token registration. The factory/parent naming relationship alone must not be treated as an asset-control permission.

No built-in recovery from losing the sole owner account is promised. The selected wallet/auth provider must document its recovery process. Owner transfer while access exists is supported; provider approval, recovery or availability is not an engine guarantee. Locked v1 deployments have no code migration path; production upgrade/recovery design is a separate explicit decision before real-money launch.

Multisig can later be added as an external owner principal. Distinguish that from optional per-payment approval policies; neither requires mandatory voting in every transaction.

## 16. Extensions and integration rules

Define an internal executor boundary:

    authorize_action(context, action) -> requirements
    reserve(requirements) -> saved_reservations
    dispatch(action, execution_id) -> Promise
    settle(execution_id, verified_outcome)

The first implementation can use enum dispatch; no dynamic plugin deployment needed.

Any later executor must define maximum asset debit, fees, success evidence, partial settlement/refund semantics, cancellation boundary and replay behavior. A cross-chain API's success response alone cannot authorize treasury debits or release reservations.

Sponsor posture:

- Aurora/HOT: optional connection or funding clients; never authority roots.
- Intents/1Click: optional settlement adapter; not required for native grants/transfers.
- NEAR AI: structured policy suggestions; human confirms exact policy.
- OutLayer: optional agent credential/execution service; child grant still checked onchain.
- Trezu/SputnikDAO: optional owner/governance account.
- Rhea/yield: separate reviewed investment executor if later requested.

No sponsor outage may weaken onchain restrictions. Availability of an optional route can fail without disabling unrelated native routes.

## 17. Implementation order and agent instructions

1. Inspect the CURRENT monorepo instructions and code only. Identify the actual Next.js app path, Rust workspace/manifest path, JS workspace configuration, package manager, current auth and CI. Implement the layout mapping from section 2.1. The old Allocard repository is unavailable and is not an implementation prerequisite; do not fetch it or invent details about it.
2. Pin a compatible stable Rust toolchain, near-sdk, near-contract-standards and near-workspaces version after checking their official compatibility requirements. Commit Cargo.lock, rust-toolchain.toml and JS lockfile. Do not blindly use latest or invent versions.
3. Implement bounded types, canonical serialization, validation and pure policy evaluation.
4. Implement authority lifecycle, hierarchy/revocation, counters and tests.
5. Implement deposits, treasury ledger, reservations and native/FT execution with private callbacks.
6. Add approval policies, replay handling, ownership handover and resource guards.
7. Complete adversarial sandbox tests, max-bound gas measurements and events/views.
8. Add the LOCAL TypeScript workspace SDK: createRootGrant, createChildGrant, preview, approve, execute, getExecution and revoke. Connect it to the existing Next.js app through an injected signer and network configuration, without rewriting unrelated pages. SDK waits for actual execution status rather than equating dispatch with payment.
9. Add deployment scripts and a minimal command-line/testnet demonstration independent of product UI. Use mock tokens in sandbox; identify testnet token provenance explicitly.
10. Integrate one auth/relayer implementation behind an SDK interface; document exactly what it signs and how actor identity reaches the treasury.

Deliver README with commands verified from the monorepo root, actual app/manifest/SDK paths, architecture/trust boundaries, errors, example policy JSON, canonical hash vectors, actual tested gas limits and known limitations. Completion requires the acceptance tests, not placeholders or screenshots. Native build example: cargo near build non-reproducible-wasm from the treasury crate directory, subject to the selected cargo-near version and actual Cargo layout. Verify the existing Next.js app still typechecks/builds with the SDK integration.

If an implementation detail conflicts with a security invariant, stop that part and document the conflict. Do not weaken inherited limits, remove reservations, use a backend as financial authority or introduce unrestricted treasury keys to make a demo pass.

## 18. Example proving the foundation

Company deposits 10,000 USDC. Owner grants manager 5,000 per seven-day fixed window. Manager grants employee 1,000 per the same window. Employee grants agent 200, with two approved recipients and no further redelegation.

Agent requests 50 USDC. Engine checks all three grants, reserves 50 in each applicable budget and 50 from available treasury funds, then dispatches. Success turns those reservations into settled usage. Failure releases them. Employee spending separately shares the employee's 1,000 cap and manager's 5,000 cap. Revoking the employee blocks the agent's next request without moving funds or updating the agent grant.

No money was allocated to an employee wallet merely by creating a grant. The 10,000 deposit is reduced only by actual outgoing payments or explicit owner withdrawals. Native operating/storage funds remain separate.

## 19. Official references

These support platform behavior; the grant schema and architecture above are Allocard design decisions.

- S1: NEAR asynchronous cross-contract execution: https://docs.near.org/smart-contracts/anatomy/crosscontract
- S2: Private callbacks: https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks
- S3: Access-key capabilities and limits: https://docs.near.org/protocol/accounts-contracts/access-keys
- S4: NEP-366 meta-transactions: https://docs.near.org/protocol/transactions/meta-tx
- S5: NEP-141 token standard: https://github.com/near/NEPs/blob/master/neps/nep-0141.md
- S6: Token storage management: https://github.com/near/NEPs/blob/master/neps/nep-0145.md
- S7: Rust contract SDK: https://github.com/near/near-sdk-rs
- S8: Sandbox integration tests: https://github.com/near/near-workspaces-rs
- S9: Contract build tooling: https://github.com/near/cargo-near

## 20. Plain-language explanation

This section explains the choices, including their costs. Except for NEAR's platform behavior, these are proposed Allocard design choices rather than requirements imposed by the chain.

### 20.1 One monorepo, two build systems and one SDK boundary

Next.js is the product application. Rust is the money-and-permission machinery. Keeping both in your monorepo means a contract change and its UI/SDK changes can be reviewed together.

Cargo builds Rust; your JavaScript package manager builds Next.js and the local TypeScript SDK. We do not pretend Rust is an npm package or move your existing folders to match an example. Root scripts make running the separate tools convenient.

The SDK is the translator between frontend/backend TypeScript and Rust contract methods. It handles exact field names, integer formats, request hashes, errors and status reads. Keeping those rules in one package prevents a page and a server route from encoding the same payment differently. The SDK takes a signer as an input, so changing wallet providers should not require changing the delegation rules.

The old repository is not available. The agent builds from this document and your current monorepo; it is not expected to inspect, port or reproduce unavailable MetaMask code.

### 20.2 One treasury contract for each company

Each company gets its own asset-holding contract and permission state. We avoid an all-companies pooled balance contract and the extra accounting it would require.

Deployment and storage cost more than simply adding a database row. Shared contract code still has shared bugs, so separate deployment is not a substitute for review.

Authority checks, budget updates and preparation of a payment remain inside this one contract. If they were separate contracts, NEAR would need extra asynchronous steps between checking a budget and reserving it. Keeping them together makes those local changes succeed or fail together.

A factory is just a deployment assistant that creates these treasuries. It is not an extra layer through which every payment must pass.

### 20.3 The engine recognizes principals, not job titles

A principal is the identity allowed to act. Initially this is a NEAR account ID. It can represent an employee, manager, automation or agent without the contract knowing their job title.

The app maps email invitations and display names to these accounts. Users need not see the account ID in normal use. However, an email string cannot itself prove that a payment was authorized.

Existing-wallet login and email login can both eventually map to authenticated principals. This version does not implement every external wallet signature scheme inside the treasury. Those integrations must produce verifiable authority through the chosen account/signing path.

### 20.4 One owner and optional governance

One authenticated owner controls the treasury initially. This avoids requiring a small team to configure voting and collect several signatures for routine administration.

The cost is concentrated authority: compromise or loss of that account matters. Recovery depends on the account solution chosen; the engine does not magically recover a lost owner.

Ownership transfer needs the recipient to accept, reducing accidental handover to an unusable destination. Acceptance invalidates all old grants so the new owner does not silently inherit permissions issued under the previous administration. That is deliberately conservative and disruptive; a future transfer mode could preserve grants only if explicitly designed.

The owner may later be a multisig contract. Employee permissions do not need to change for that to happen.

### 20.5 A grant is permission, not a separate balance

A grant records who issued authority, who received it, what it permits, when it is active and whether it can be passed on.

Creating a 500-USDC grant does not send or lock 500 USDC. The company still controls its funds. This supports your goal of keeping capital together.

It also means an allowance is not a payment guarantee. Ten people can each have a 500-USDC ceiling while sharing a smaller treasury. The app must distinguish permission from available money.

### 20.6 Immutable grants and the reason for replacement

We do not edit an existing grant's terms. To change them, revoke the old grant and create a new one.

This avoids a child suddenly acquiring broader authority because its parent was edited, and makes it clear which rules an execution used.

The drawback is administrative work: children of a replaced grant remain disabled and must be recreated beneath the replacement. A polished UI can assist, but cannot silently reactivate them. Historical grants also occupy storage.

Self-delegation is excluded in this version because direct use of an existing grant is sufficient for the current model. This is a simplifying restriction, not a NEAR limitation.

### 20.7 One parent per grant and one selected grant per payment

A child derives authority from exactly one parent. A principal may hold several grants, but a payment chooses one chain of authority.

This makes it possible to answer who authorized a payment and which budgets it consumed. We do not combine two 100-USDC grants to authorize a 200-USDC payment.

Combining grants or having multiple parents is possible in a different design, but requires rules for distributing costs, approvals and revocation. We are leaving that complexity out.

### 20.8 Redelegation is controlled at each level

A manager may create children only if their own grant allows it. Each child must have less remaining redelegation depth.

Child creation rejects obvious expansions, such as adding an asset or recipient the parent does not permit. More importantly, every later payment still checks the whole chain. Child configuration can never remove an ancestor's restriction.

The chain is limited to eight grants so checking a request has a bounded cost. This number is an initial engineering limit to test, not a claim that eight is universally ideal.

### 20.9 Parent budgets include descendant spending

Suppose a manager has 1,000 USDC and creates two employee grants of 800 USDC each. Those children do not create 1,600 USDC of usable manager allowance. All direct and descendant spending still shares the manager's 1,000.

If the manager spends 300, descendants have at most 700 of parent capacity left. Each child's own cap can restrict it further.

Separate root grants do not share a permission counter unless there is a real common ancestor. They do still share the company's actual treasury liquidity.

### 20.10 Explicit assets, recipients and budget policies

Each asset must be named explicitly by its contract identity (or native NEAR), not by a possibly ambiguous symbol. No permission for an asset means no spending authority for it.

Recipient rules either permit any recipient or name an explicit set. A label such as software vendors is not something a contract can infer from an address; the application must turn it into supported concrete rules.

A per-payment cap limits one transaction. A lifetime cap limits all spending under that grant. A recurring cap limits one defined time bucket. These can apply together.

An unlimited cumulative allowance requires explicit acknowledgment. Otherwise, someone could accidentally believe that a 100-per-payment restriction also limits the month's total.

### 20.11 Fixed periods rather than ambiguous monthly rules

The first version uses a duration and starting point: for example, seven days from a specified timestamp. The contract can calculate exactly which bucket applies.

This is neither a rolling last-seven-days budget nor a calendar month. Someone could spend near the end of one bucket and again at the start of the next. That is expected fixed-period behavior.

Calendar months are a reasonable product need, but need explicit timezone and boundary semantics. We defer them rather than implement 30 days and misleadingly call it monthly.

Different ancestors may use different periods. An agent's daily cap and a manager's weekly cap can both apply; the engine checks each independently.

### 20.12 Exact amounts and separate asset budgets

Money is stored as integers in the token's smallest unit. For a six-decimal token, 1 token is represented as 1,000,000 base units. JavaScript Number is not safe for arbitrary large amounts, so the SDK uses exact integer handling and JSON strings.

We also do not treat 1 USDC, 1 USDT and 1 NEAR as interchangeable budget units. A combined dollar budget would require price sources, rounding and failure rules. Separate asset budgets avoid that dependency initially.

### 20.13 Approval is optional and does not replace a budget

A grant may require a named person to approve payments above a threshold. That is a policy option, not mandatory treasury multisig.

The approval is for this actor's exact payment using this grant, before its deadline. It cannot be reused for a different recipient or amount.

Approval does not reserve funds or force payment. When the employee executes, the engine checks the budget and treasury again. An approval cannot authorize 600 when the budget permits only 500.

After a failed payment, a deliberate retry needs a new request and new approvals. This is extra friction, but avoids treating consent to one attempt as indefinite consent to repeated attempts.

### 20.14 Authentication, login and session keys are separate

The contract trusts the authenticated immediate caller, not an actor field sent by the frontend. Otherwise anyone could submit an employee's account name and pretend to be that employee.

A login provider helps a user obtain a signing identity. Restricted account keys can make repeated interactions smoother. Neither decides the user's remaining spending allowance.

An agent needs its own principal and child grant if it must have narrower access than an employee. Giving it an employee credential could let it exercise all authority accessible through that credential.

A relayer submits signed transactions and sponsors gas. Its submission must not change who actually authorized the request.

### 20.15 Previews do not reserve money

The UI can ask what would happen before requesting a signature. That makes failures understandable and helps show missing approvals.

Another payment can use capacity between preview and execution. Therefore the contract checks again when dispatching. A green preview is not a promise that a later transaction will pass.

### 20.16 Reservations solve concurrent spending

NEAR may process other requests while an external transfer is in flight. Without reservations, two payments could both observe the same remaining allowance.

Before dispatch, the engine subtracts the amount from available treasury funds and marks it pending in every affected budget. The next request sees that commitment immediately.

These local changes and scheduling the external transfer happen in the same originating receipt. Failure before dispatch must not leave half-updated budgets.

This temporary commitment differs from reserving an employee's entire allowance when creating a grant. We reserve only actual authorized payment attempts.

### 20.17 Dispatch and settlement are different facts

An accepted request means the treasury scheduled a transfer. It does not mean the recipient has been paid.

On success, pending budget becomes settled spending. On proven transfer failure, budget capacity and principal become available again. Settling twice must never change accounting twice.

The execution record stores the original budget buckets. If a Friday payment finishes after a weekly reset, its settlement still belongs to the bucket in which it was authorized.

The first executors send direct NEAR or accepted fungible tokens. They do not use an extra receiver callback whose meaning would require a more complex settlement model.

### 20.18 Missing callbacks are a real limitation

If the engine has no trustworthy outcome, it cannot safely assume either that money was spent or that it was returned.

It keeps the reservation locked. After ten minutes an observer may flag the case for investigation, but that does not release money. Ten minutes is an alert threshold, not a financial guarantee.

This prioritizes preventing overspending over automatic recovery. It can temporarily or indefinitely reduce usable budget if settlement fails. A reliable, verifiable recovery design is important before production; an administrator's unverified claim is not a substitute.

### 20.19 Duplicate requests must not duplicate payments

Every request has a unique ID and a fingerprint of its exact contents, actor, treasury and network.

If the browser retries the same request after losing connection, the contract returns the original execution instead of sending again. Reusing that ID for different contents is rejected.

This remains true after the deadline or a revocation: returning an old record does not create a new authorization. To intentionally retry a failed payment, submit a new ID.

Fingerprint encoding must match between Rust and TypeScript. Shared test vectors catch differences before they can affect real requests.

### 20.20 Revocation, blocking, pause and global invalidation

Revocation disables one grant and therefore all children that rely on it. An account block disables that account wherever it appears in an authority path. Pause stops new treasury spending. Global invalidation disables all grants from an old authority generation.

These are different controls for different incidents. The generation number lets the owner invalidate a large permission tree without updating every record.

They affect future dispatch, not already-sent payments. Callbacks must continue running so emergency actions do not break the books. Deposits can continue during pause because receiving funds creates no new spending authority.

### 20.21 Two sets of accounting: authority and actual money

Budget counters answer whether a principal has permission left. The treasury ledger answers whether funds are available.

Both must pass. Having a large balance does not bypass a grant limit, and having a large grant does not invent a balance.

Owner withdrawals use the same pending-money accounting so they cannot take funds already committed to another payment. They do not consume employee budgets because the owner is exercising owner authority.

The owner can withdraw uncommitted funds even if employees have unused allowances. This matches company control, but the application should warn that those allowances may then be unfunded.

### 20.22 Deposits and token registration are deliberate

FT deposits use the token standard's receiver flow, so the treasury can authenticate which accepted token called it and record the credit. A random backend balance update cannot create spendable funds.

A direct token transfer that bypasses that flow may arrive externally without being recorded internally. This version does not promise automatic recovery. The deposit interface must guide users through the supported path.

Tokens also have account-storage registration requirements. The first version prepares that separately instead of letting every employee payment spend arbitrary extra company funds on registrations.

This means some valid recipients need a preparation step. That is a product friction to solve intentionally, not pretend absent.

### 20.23 Operating costs must not consume committed capital

The contract needs native NEAR for storage and certain attached deposits even when the company spends a stablecoin. Gas sponsorship does not eliminate every native funding requirement.

We separate spendable native principal, storage funding and operating funds. The contract checks both bookkeeping and actual solvency.

This adds accounting work but prevents a treasury from promising money that is required to keep its state alive. The app should show operating health in ordinary terms rather than expose raw storage math to employees.

### 20.24 Bounded work and persistent history

The draft proposes caps of eight grants per authority path, sixteen assets per grant, sixty-four listed recipients per permission, sixty-four pending executions, 1,024 total grants and 8 KiB request bodies. Approvals have a seven-day maximum lifetime.

These bounds keep costs predictable and limit abuse. They are initial values, not measured NEAR throughput guarantees. Some are hard schema bounds and others initialization configuration; the current spec does not promise live changes to every cap.

We retain grants, request identities and budget history instead of deleting records casually. That protects ancestry checks and duplicate-payment prevention but increases storage usage and eventually reaches configured capacity. Safe pruning and expansion/migration are later engineering needs, not solved scalability.

### 20.25 Events, errors and the database

Events describe what happened; stable error codes explain what prevented an action. The SDK translates them into usable application messages.

An indexer/database makes lists and search fast. The contract remains authoritative for current permissions, balances and execution state.

We avoid unbounded contract methods that return everything. The frontend can use indexed history while checking current financial facts against the chain.

Next.js keeps sensitive application and provider credentials on the server. No browser bundle gets a treasury full-access key, and an ordinary server login is never treated as authority to spend.

### 20.26 Restricted executors rather than arbitrary calls

A contract-call permission is potentially much more powerful than a transfer. A call could create future spending rights or move assets in a way our counters cannot understand.

We therefore begin with explicit transfers. A later swap, yield or cross-chain executor must state maximum debit, fees, proof of completion and refund handling before it becomes available.

This makes adding features more work, but preserves a meaning for spending restrictions. The foundation is reusable in its authority model without claiming every arbitrary action is safe.

### 20.27 Sponsor integrations stay replaceable

Aurora/HOT can assist with connection or funding, Intents with external payment routes, NEAR AI with drafting policies, and OutLayer with agent signing. None is required to evaluate a native grant.

A service outage can make its route unavailable. It cannot make a restricted payment become allowed. One selected login provider still has its own availability/recovery dependencies; independence of the engine does not make every user magically independent of their credentials.

### 20.28 Deployment keys, upgrades and production readiness

A retained full-access treasury key can bypass the application or replace its contract. Testnet development may use one, but we must disclose that control.

Removing such keys restricts control to the contract, but this draft supplies no in-contract upgrade mechanism. A locked deployment cannot casually receive new features or bug fixes. That is a major tradeoff, not an automatic recommendation for a live business.

Before production, upgrade governance, owner recovery and unresolved execution recovery need deliberate decisions and review. This specification is enough to implement and test the foundation; it is not evidence that real funds should be deposited immediately.

### 20.29 Why these tests and this implementation order

The acceptance tests target ways financial rules can fail: overlapping payments, ancestor revocation, period changes, forged identity, malicious callbacks and duplicate submissions.

The agent builds authority and accounting before polishing a UI. Then the local SDK and Next.js application expose the tested behavior. This avoids a convincing interface disguising incomplete financial guarantees.

Unit tests check small calculations, property tests try many combinations, and sandbox tests verify real receipt/callback behavior. Maximum-size cases must also fit actual gas and storage limits.

The 26 listed scenarios are required acceptance categories, not a claim that exactly 26 individual test functions establish security.
