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

## Follow-up: zero-balance employer delegation

A tester reported `INVALID_TRANSACTION / NotEnoughBalance`, with zero native NEAR in the employer's implicit account. The employer root-permission operation still used wallet-funded signing. Treasury mock USDC cannot pay that wallet's native transaction fee. The reported rejection occurred before execution.

Employer allowance creation now uses an employer-signed NEP-366 action paid by the existing relayer. The server validates company ownership, active employer membership, the accepted employee, the exact signed policy, verified treasury code and unallocated funds. It journals the transaction before broadcast and recovers the same grant after uncertain results. The generic root-permission transport cannot fall back to charging the user's wallet. Employer and employee-agent revocation also use bounded sponsorship and remain possible while paused or expired. No contract redeployment or database migration was needed.

The server agent-permission preview now allows the child recurring window selected in the updated drawer. Parent windows remain independently enforced by the contract; other inherited bounds remain unchanged.

Validation: all 485 web tests passed, including real-signature root/revocation coverage, authorization failures, zero-deposit gas bounds and root recovery without allocating twice. Type checking, targeted lint and production compilation/page generation passed. Deployment `dpl_72FKPykA35A6Zok3HujrMDzewhJ4` is `READY` and aliased to `https://www.allocard.xyz`. A fresh signed-in delegation from the tester remains the live end-to-end confirmation.

## Follow-up: agent AI parsing timeouts

Production runtime logs showed two `POST /api/policies/parse` requests returning HTTP 503 after the NEAR AI call reached its 35-second timeout. The agent drawer and authorization path were connected; the provider call was not completing within that budget. A synthetic full employer-policy request with the previous settings took 20.1 seconds locally.

Policy compilation now explicitly disables additional thinking on the hosted DeepSeek V4 model using `chat_template_kwargs.enable_thinking: false` and asks for a short explanation. A live synthetic probe confirmed zero reasoning tokens; the upstream `thinking.type` parameter was ignored by this host and is not used. Policy validation, parent-bound enforcement, the signature requirement and rejection of unavailable AI remain in place. Token-truncated responses are rejected even if their content happens to parse as JSON. Timing logs include model, elapsed time, finish reason and reasoning-token count, without policy text or credentials.

Validation: 23 focused provider, authorization, drawer and agent-policy tests passed; type checking and targeted lint passed. Real full-compiler synthetic checks passed for an employer policy in 7.7 seconds and an agent policy with parent limits in 6.9 seconds. The production build's opt-in credential check passed in 4.9 seconds with zero reasoning tokens. These timings are samples, not a latency guarantee; a fresh signed-in agent request is still needed to confirm the user's exact policy.

Deployment `dpl_ErHMEf8Ks1ASUR47CEgdQYp8QeXL` is `READY` and aliased to `https://www.allocard.xyz`. Reload existing dashboard tabs to use the updated policy flow.

## Follow-up: agent setup and dashboard layout

Shared agent spending access is labeled “Agent setup” in the sidebar, delegation list, canvas and policy drawer. “Purchasing Research agent v2” is reserved for the research worker selected for a task and its results. User-facing setup errors use “agent”; internal identity names and permission checks remain compatible with existing grants.

The delegation table uses a container query: above 760px of available section width it keeps aligned columns; at narrower widths each row presents identity, issuer, labeled limits and a wrapping action row. Actions remain visible without horizontal scrolling. Status appears beside the role, and the duplicate mobile detail row is removed. Hierarchy expansion and search remain functional. The Add employee modal now has one instruction explaining the email and sign-in invitation flow, with its repeated helper paragraph removed.

Validation: 87 relevant hierarchy, activity, policy-drawer, agent-workspace, research, email-identity and sponsorship tests passed. Type checking passed and targeted lint had no errors; existing warnings remain. Container layout has not been inspected in an interactive browser in this session.

## Follow-up: mobile rows, empty state and sponsor connectivity

The mobile stacked-row layout was replaced by a horizontally scrollable table below 768px, with an opaque Actions column pinned to the right. Desktop uses the regular table. Empty and filtered-empty messages sit outside the horizontal scroll area so they remain centered in the visible frame, including tablet widths.

Production agent activation returned the sponsor's generic RPC connection error. Historical logs showed failed sponsor requests but did not preserve the underlying provider response. A later read-only check of the locally configured RPC returned testnet status and gas price successfully; this does not establish the cause of the earlier production failures.

The sponsor now retries transient read-only network, gas-price and transaction-status calls at most once. It shares provider cooldown handling with regular reads, stops on credential failures, and distinguishes HTTP rate limits and access errors. Safe diagnostic logs record operation, attempt, HTTP status and failure category without credentials, provider URLs, arguments or signed data. Broadcasts are never retried automatically; existing transaction journals and authoritative rejection handling remain in place.

Validation: 75 focused sponsorship, transport, hierarchy and loading tests passed, with type checking and targeted lint also passing. Browser verification was blocked by missing Chromium system libraries; no visual verification is claimed.

Deployment `dpl_DRbSC4q9yfp5sZoqQFuRxjVhm1Td` is `READY` and aliased to `https://www.allocard.xyz`. Production compilation and type checking passed. Reload dashboard tabs before retrying the original agent setup.
