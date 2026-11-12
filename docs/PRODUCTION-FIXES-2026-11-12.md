# Production follow-up: payments, policy parsing and dashboard guidance

## Changes

1. Direct payments run independent ownership, permission, preview, nonce, network and recipient-storage reads concurrently. Preparation and submission still perform fresh authorization, and the contract remains authoritative. A redundant browser preview is removed. The SDK reuses an already verified terminal execution instead of reading it again. History verification reads the execution and transaction concurrently, with exact request binding. The UI shows confirmed settlement while history saves; a failed history write keeps the original request for synchronization without another payout.
2. NEAR AI uses the documented `https://cloud-api.near.ai/v1` endpoint. Both `NEAR_AI_API_KEY` and `NEARAI_API_KEY` are supported, empty values do not shadow valid credentials, and provider response bodies are excluded from errors. Unavailable AI returns a clear service error rather than presenting rules fallback as AI interpretation. The compiler receives the current timestamp and instructions for relative expiry. The parsing route has an explicit 60-second execution limit.
3. Employer policy drawers use the employee's verified email as the primary identity. The NEAR account remains under optional technical details and is still used internally for authorization.
4. Both drawers share a shorter review: total budget, configured recurring allowance, per-payment cap, recipients, payment count if configured, and the access end date. Inheritance and qualitative guidance are explained separately.
5. The employee's first direction says only: “Go back to the employer dashboard.” Existing opt-out and restart behavior remains.
6. Both first balance cards have a small, fixed-size refresh icon positioned outside document flow. Refreshes keep the last confirmed values visible and do not change the cards' padding, grid or dimensions. Repeated clicks share the ongoing refresh.
7. Agent setup uses the same AI/manual/review drawer with employee-scoped parsing authorization. The chosen child recurring window is signed, rather than overwritten by the employer's window. Every ancestor window continues to apply independently. Mandatory recipient, amount, expiry and execution bounds are inherited or narrowed; active-policy reviews read the saved verified permission. The original policy text is persisted as guidance, not represented as an extra on-chain restriction.

## Verification

- 474 web tests and 36 SDK tests passed, including refresh behavior, early settlement display, history recovery, agent-policy narrowing, request identity checks and scoped AI authorization.
- Type checking passed; targeted lint has no errors. An existing image-optimization warning remains.
- A synthetic full policy passed the real AI compiler, including the weekly allowance, payment cap, exact recipient, payment count and relative expiry, in about 16.5 seconds.
- The deployment's production AI credential passed a separate structured policy smoke check in about 2.6 seconds. This check is opt-in via `ALLOCARD_AI_SMOKE=1` during deployment.
- `[payment timing]` logs report preparation and submission durations for the next real payment. New end-to-end payment latency requires a fresh signed-in transaction; test results do not establish a guaranteed duration.

No contract redeployment or database migration is required for this follow-up.

## Deployment

Live at `https://www.allocard.xyz`, deployment `dpl_6iUfvZb3GiVJE6Vz5fyRjgDj79Md` (`READY`). Compilation, type checking and page generation passed. Live checks returned HTTP 200 for the homepage and schema-5 treasury endpoint, correct employer/employee sign-in redirects, and HTTP 401 for unauthenticated policy parsing. Reload existing dashboard tabs to use the new client code. An authenticated payment timing measurement remains for the next user transaction.
