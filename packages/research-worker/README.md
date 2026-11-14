# Allocard research worker

This worker runs the listed Purchasing Research agent v2 through the direct demo channel. It does not replace the NEAR AI Market listing or create paid marketplace hires.

Production endpoint: `https://allocard-research-worker.vercel.app`.

Required Production environment variables:

- `ALLOCARD_AGENT_SECRET`: same service secret as the app.
- `ALLOCARD_APP_URL`: canonical app origin (`https://www.allocard.xyz`).
- `NEAR_AI_API_KEY`: NEAR AI Cloud model credentials.
- `NEARAI_MODEL`: supported research model, currently `Qwen/Qwen3.8-27B`.

`NEARAI_API_KEY` and `NEAR_AI_MODEL` are also supported aliases. Empty values do not override a populated alias.

The app's `ALLOCARD_AGENT_URL` must point to this worker. Health verifies the authenticated app callback and model/search pricing, not just the existence of a process.

`POST /allocard/jobs` atomically claims the approved app task before invoking the model. Only the first successful claim gets the authoritative brief. The model runs under Vercel `waitUntil`, with a bounded timeout; completions and failures are persisted in the app database. `GET /allocard/jobs/:id/:digest` reads durable app status rather than an ephemeral runtime session.

A retry cannot run a second model call for an existing claim. A task with no recorded claim can be dispatched again under the same approved task ID after the app rechecks employee access. Stale claimed tasks time out to a visible failure instead of occupying a concurrency slot indefinitely. Failed requests require a fresh employee-confirmed hire to run again.

Research requests disable extra reasoning and request a concise report. Only a completed, sourced final answer is persisted; intermediate notes and truncated responses are rejected. The app atomically saves the call result and task outcome, and identical completion callbacks acknowledge the same report. Worker logs record research duration, model, actual search count and successful persistence without printing credentials or briefs.

The provider can exceed the requested `max_tool_calls`: the production canary returned five searches despite requesting three. Treat that setting as advisory and the pricing reservation as an estimate, not a provider-enforced billing cap. The worker retains its request timeout and app admission quotas.

On 2026-11-14 an isolated production canary completed in approximately 28 seconds, persisted a 2,421-character report, and returned that same report on duplicate submission with one durable claim. Its temporary diagnostic records were removed. See [the verification report](../../docs/RESEARCH-WORKER-FIX-2026-11-14.md).

Run tests with `node packages/research-worker/tests/worker.test.mjs` from the repository root. Deploy this directory as a Vercel project with the included `vercel.json`. The marketplace Eve project stays independent.
