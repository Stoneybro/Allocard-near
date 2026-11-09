# Allocard research demo operations

The demo discovers real marketplace listings, but executes only Allocard's configured purchasing research worker directly on Vercel. Employee confirmation does not create a marketplace job, escrow, purchase, subscription, or payout. Model, search and hosting usage still cost the operator money.

## Implemented flow

1. An employee opens Purchasing research in their dashboard and creates the adapter child permission using their wallet, with gas paid by the relayer. It inherits the parent permission restrictions.
2. Allocard checks membership, company ownership, database bindings and the live child/root NEAR permission path. Paused treasuries, revoked/expired permissions and blocked principals are rejected.
3. Preparing a request discovers listings and saves an expiring proposal. Only the owned adapter can execute. Other listings are discovery-only.
4. Employee confirmation binds the original brief, company, employee, delegation, worker and zero marketplace price through a digest. It admits the request under database locks.
5. A durable job dispatches to the authenticated worker. The worker claims a unique billable research call, obtains the authoritative brief from Allocard, researches up to three software options, and persists its report. It cannot purchase anything.
6. Employee status polling and completion callbacks advance queued jobs. Company owners can inspect their company research history.

A shared adapter identity does not pool employee funds. Each employee has a separate child permission and job scope. No treasury key is sent to the worker. This demo checks on-chain permission but does not execute a treasury transaction or consume its on-chain execution counter; application quotas apply to research requests.

## Limits and costs

- 12 concurrent jobs globally; 2 per employee.
- 100 queued jobs; 25 approvals per employee/day; 500 globally/day.
- $25/day tracked variable-cost ceiling; reserve $0.25 per executed job conservatively. The effective budget may stop admission before the nominal count limit.
- Executed-job reservations remain charged against that day's application budget. Exact provider invoice reconciliation and reservation refunds are not implemented. Pre-dispatch cancellation/expiry releases its reservation.
- Current worker model: `Qwen/Qwen3.8-27B`. Readiness checks public model/search pricing and rejects pricing that exceeds the reservation. It is not a guarantee of account credit, account-specific concurrency or provider availability.
- Public provider documentation reported a default of 64 concurrent requests per model. Account-specific capacity was unavailable; the reduced demo limits remain in place.

Vercel Hobby does not support a minute cron. Dispatch is request-driven using active client polling and completion/failure callbacks. An optional authenticated scheduler endpoint is available at `/api/internal/agent-adapter`; uninterrupted unattended queue draining requires an external scheduler. If all clients close and a callback is lost, jobs may wait until polling or a scheduler resumes. Ambiguous submissions retain their original identity and reservation; do not blindly retry them as new jobs.

## Configuration

Allocard server environment:

- `NEAR_ADAPTER_ACCOUNT_ID`: dedicated shared adapter identity.
- `ALLOCARD_AGENT_URL`: fixed HTTPS worker origin.
- `ALLOCARD_AGENT_SECRET`: separate service credential, at least 32 characters; same value on worker.
- `CRON_SECRET`: only needed by an external scheduler.
- `ALLOCARD_WORKER_BYPASS`: optional Vercel automation credential for a protected worker preview.

Worker environment:

- `ALLOCARD_APP_URL`: fixed HTTPS Allocard origin.
- `ALLOCARD_AGENT_SECRET`: shared service credential.
- `NEARAI_API_KEY`, `NEARAI_MODEL`.
- `ALLOCARD_APP_BYPASS`: optional automation credential for protected Allocard preview callbacks.

`MARKET_AGENT_TOKEN` and `MARKET_WEBHOOK_SECRET` already exist in the worker project. The direct demo does not require them. Market credentials remain restricted to the market channel. The purchasing tool currently runs only in the Allocard channel; this implementation does not claim to provide paid marketplace execution.

Run `pnpm --filter @allocard/web adapter:configure -- --worker-env --register` to configure/register the dedicated adapter. Generated keys and service credentials stay in ignored environment files; never commit them. Creating a public adapter record does not grant employee permissions or move funds.

Database migrations `0012_agent_research.sql` and `0013_agent_research_calls.sql` add durable jobs and one-call claims. They have been applied to the configured database; the schema check passed for 177 fields across 20 tables.

## Preview verification and release

- Allocard preview: https://allocard-research-demo-stoneybro.vercel.app
- Worker preview: https://purchasing-research-demo-stoneybro.vercel.app
- Source for the companion worker is preserved under ignored `.agent-work/worker`; a portable source review bundle is also saved at `.agent-work/worker-source-review.tar.gz`. GitHub denied the connected integration permission to create a review branch; no worker repository changes were published.
- Worker build, typecheck and tests passed. Its deployed authenticated health endpoint returned ready and rejected missing service authentication.
- Allocard remote preview build, full 268-test suite, five additional billable-call authorization tests, and TypeScript checks passed.
- Production deployment and production runtime configuration have not been promoted by this implementation.

Before production promotion, use a real employee account to create the child permission, prepare and approve a request, and verify delivery plus the owner history. Repeat with two employees to observe isolation and queue behavior. This signed end-to-end execution has not yet been verified. Preview health does not establish successful billable execution.

Reconcile ambiguous jobs against the original worker session and provider usage before releasing capacity or preparing another run. Never replace marketplace execution with a local run while labeling it as marketplace execution.

## Recovering an uncertain adapter permission

Configuration loading and permission signing now have separate UI states. Creating a configuration is explicitly described as unsigned and does not claim that funds moved. Signing errors appear in the rules drawer, a toast, and the browser console; RPC transport/rejection diagnostics also appear in server logs.

If a transaction was already signed, open the pending adapter's rules, paste its hash under **Already signed a transaction?**, and select **Check and recover transaction**. This reads its outcome, verifies the signer, treasury, company, parent and adapter, then links the confirmed permission. It does not sign or broadcast anything. The server independently checks the actual live child permission before activation.

New uncertain submissions retain their hash in browser storage. Retrying the same action queries that hash rather than signing again; different actions cannot bypass reconciliation. Keep the same browser storage when recovering. A provider timeout or `NOT_OBSERVED` response is not proof of either success or failure; leave the original transaction unresolved until its status can be established.

## Sponsored permission gas and validation rejection

Adapter permission creation now uses an employee-signed NEP-366 meta-transaction. The configured relayer pays gas; the employee wallet may have zero NEAR. The signed action calls only `create_child_permission` on the employee's registered company treasury, with zero attached deposit and the configured adapter as delegate. Sponsorship is controlled by `NEAR_SPONSOR_ENABLED` and the existing relayer credentials, gas limits, daily quotas, key lease and durable transaction journal. There is no wallet-funded fallback for adapter creation.

Before quoting and relaying, the server validates employee membership, ownership of the pending child record, the correct company and parent, the configured adapter, live parent expiry/revocation/epoch/blocklist state, and child rule narrowing. The employee's signature, nonce and bounded expiry are verified again before relay. No treasury signing key is provided to the relayer or worker.

The server extracts the child permission ID from the treasury receipt and verifies its live issuer, parent and adapter binding, even when the outer NEP-366 receipt has an empty return value. The browser persists the exact adapter proposal until on-chain creation and database activation both succeed. Retrying the same rules first recovers the original sponsor job. Changing the rules while that job is unresolved is rejected. Sponsored transaction recovery happens by retrying Sign & Activate with the same rules; the manual transaction-hash field is for earlier wallet-funded attempts.

An unresolved older adapter transaction no longer blocks an unrelated sponsored employee payment. Unknown payment submissions still block a new payment; disabled sponsorship never bypasses reconciliation by charging the employee wallet. Before replacing an older direct adapter attempt, recover it if confirmed or explicitly reset it only when the RPC rejected that exact hash as INVALID_TRANSACTION. Unknown status, timeout and NOT_OBSERVED are not grounds to discard it.

Explicit send_tx validation rejections expose `data.TxExecutionError.InvalidTxError` and release only the exact rejected submission. Ambiguous submissions retain their original transaction identity and are never automatically rebroadcast.

Profile/dashboard queries use authenticated, private GET requests at `/api/dashboard`, validating the requested wallet against the session. They do not wait in Next's sequential Server Action dispatch queue. Independent membership/preference profile database reads also run concurrently. Actual database/RPC outages can still fail reads.
