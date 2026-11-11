# Reserved agent budgets (shared treasury v4)

New shared companies use `treasury-v4.allocardfactory.testnet`. The release was deployed keyless in transaction `BpF6q7g5EsHWeKwzpxgj4uos9iXNLnSuEV1hPiXdH7s9`; its code hash is `4uDFzMYH1metwCUgfxYs8kqoQXs99pUHibBA3JRJnuML`.

Company delegated totals count active company-issued root permissions once. Employee child permissions and descendants do not increase the company allocation.

A finite child lifetime budget reserves its unused amount against the parent. Pending and settled spending reduce the unused allocation; failures restore it. Direct payments cannot consume siblings' allocations. Revocation, expiry and authority-epoch invalidation release unused allocations. Reversible principal blocking preserves the allocation so unblocking cannot create an over-allocation. There are at most 16 live immediate children per permission to bound gas; repeated research hires reuse the same permission.

For an initial 1,000 USDC allowance and a 300 USDC agent allocation, direct capacity is 700 USDC. If the agent spends 100, total remaining is 900 and its unused allocation is 200; direct capacity remains 700. Revocation releases that unused 200.

The v4 balance API is `get_reserved_budget(permission_id, asset, exclude_child)`, with `company_id` for shared treasuries. Descendant spending excludes its own immediate path branch while protecting siblings. Both preview and execute enforce these rules; the dashboard reads the same on-chain counters.

Existing immutable shared-v3 and dedicated-v2 accounts retain their original behavior and pinned binaries (`allocard_shared_v3.wasm` and `allocard_treasury_v2.wasm`). They are not silently migrated. Existing workspaces need an owner-managed migration or a fresh workspace to adopt v4 reservations. Do not clear databases or overwrite stored treasury references to simulate a migration.

Employers delegate to employees and can view or revoke employee agent permissions. The current research hiring flow requires the company → employee → agent chain, so new direct company-to-agent delegations are rejected and removed from the employer picker.

Validation includes Rust unit tests and `shared/tests/mock_usdc_sandbox.rs`, which transfers real mock-USDC balances in an isolated NEAR sandbox and verifies direct-spend rejection, agent spending and revocation.
