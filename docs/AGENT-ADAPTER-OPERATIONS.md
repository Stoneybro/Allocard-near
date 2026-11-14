# Purchasing Research operations

The Purchasing Research agent is listed on NEAR AI Market. Allocard discovers marketplace listings but executes only this agent in the demo, through the worker in `packages/research-worker`. Research is free to the treasury: it does not create a paid marketplace hire, submit a treasury payment, or consume an on-chain execution counter.

## Setup

Configure these server-only app variables in `apps/web/.env.local`:

- `NEAR_ADAPTER_ACCOUNT_ID`: dedicated adapter identity registered in the app database.
- `ALLOCARD_AGENT_URL`: fixed HTTPS origin of the deployed research worker.
- `ALLOCARD_AGENT_SECRET`: at least 32 characters, matching the worker.
- `ALLOCARD_WORKER_BYPASS`: optional credential for a protected worker deployment.
- `CRON_SECRET`: optional, for an external queue scheduler.

Apply all database migrations, including research task/call tables. From the repository root:

```sh
pnpm --filter @allocard/web run db:migrate
pnpm --filter @allocard/web run adapter:configure -- --register
```

The adapter script generates an identity/service secret if absent and registers its public identity. Set `ALLOCARD_AGENT_URL` to your actual worker, rather than relying on the script's older default origin. Registration grants no spending authority; the employee must separately sign its child permission. Generated credentials remain in ignored environment files.

Deploy `packages/research-worker` as a Vercel project. Configure its `ALLOCARD_APP_URL` as the reachable HTTPS app origin, the matching `ALLOCARD_AGENT_SECRET`, `NEAR_AI_API_KEY`, and `NEARAI_MODEL`. Localhost is not reachable from a remote worker: use a configured HTTPS development origin for callback verification. `ALLOCARD_APP_BYPASS` is optional for protected app deployments. Marketplace channel credentials are not required by this demo worker. See the [worker README](../packages/research-worker/README.md).

Preparation checks the worker's authenticated `/allocard/health` endpoint, app callback access, and public model/search pricing. Readiness does not guarantee account credit or provider availability, and does not invoke a research job.

## Task lifecycle

1. The employee reviews and signs agent access bounded by their company permission. NEP-366 sponsorship covers child creation and revocation.
2. **Add agent** opens a brief; **Find agents** discovers marketplace listings. Only **Purchasing Research agent v2** is executable in this demo.
3. **Hire** prepares the exact brief; **Confirm and start** authorizes dispatch. The server verifies identity, company, and the live employee/agent permission chain.
4. The worker atomically claims the approved database brief before calling NEAR AI Cloud web search. It cannot purchase anything or access treasury signing keys.
5. A completed final report with search activity and source URLs is persisted through authenticated callbacks. Partial/truncated responses fail rather than appearing delivered. Duplicate claims do not repeat the model call.

Companies can inspect research associated with an agent permission. Owners cannot edit employee-issued agent rules, but can revoke that agent's access. Revocation blocks new and not-yet-started tasks; a running task may finish.

## Limits and recovery

Admission limits are defined in `apps/web/lib/agent-adapter/shared.ts`: 12 concurrent jobs globally, two per employee, 100 queued jobs, 25 employee approvals/day, 500 global approvals/day, and a tracked $25 daily application budget with $0.25 reserved per executed job. These are application limits, not on-chain payments or exact provider invoice reconciliation. Provider search-count settings and cost reservations are not hard billing caps.

Active task polling and completion/failure callbacks advance the queue; an optional authenticated scheduler can also drain it. Closing all clients can delay recovery if a callback is lost. Ambiguous submissions retain their original identity. A worker retry reads durable task status; it must not start a second model call for an existing claim. Failed tasks require a new confirmed task.

For uncertain permission activation, retry the same reviewed policy to recover the original transaction and verify its issuer, parent, company, and adapter. Do not discard unknown outcomes or change the policy to bypass reconciliation. Optional reviewed legacy-rejection hashes apply only to explicit historical RPC rejections, not arbitrary timeouts.

Run worker tests with:

```sh
node packages/research-worker/tests/worker.test.mjs
```

These mock provider and callback responses. A live two-session run and a sourced report are separate acceptance evidence; see [walkthrough checks](delegation/TODAY.md).
