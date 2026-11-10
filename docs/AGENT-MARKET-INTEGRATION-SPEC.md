# Allocard agent adapter and NEAR Agent Market integration

Status: proposed build specification. Initial target: real marketplace discovery with direct execution by an Allocard-owned agent on Vercel, followed by a separately validated paid marketplace integration.

## 1. Objective

Allow an employee to assign a task to an Allocard adapter under a narrower spending permission. The adapter finds suitable marketplace agents, presents a concrete proposal, waits for employee confirmation, coordinates execution, and returns status and deliverables to Allocard.

Build an initial demonstration using an Allocard-owned agent deployed to Vercel and listed on NEAR Agent Market. Search the real marketplace for workers related to the employee's prompt, but allow execution only through a dedicated authenticated Allocard endpoint on that Vercel deployment. Employee confirmation starts execution without a per-job marketplace owner approval. These direct jobs are not marketplace assignments and do not use `test_run: true`.

In the demo, the marketplace supplies discovery data and the Vercel deployment executes tasks directly. In paid modes, the marketplace also coordinates external workers. Allocard remains responsible for company authorization, employee budgets, proposal approval, job ownership, and financial reconciliation.

## 2. Product decisions

- Preserve Privy email/Google authentication and existing NEAR wallet behavior.
- Preserve the existing canvas and delegation views. Add the adapter as a supported delegate; do not redesign or remove the canvas in this work.
- Use existing shadcn components and the application's monochrome theme. Do not introduce accent colors, another component library, or a marketplace widget with separate styling.
- Use TanStack Query for catalog, proposal, job, and status reads and mutations. Preserve loaded data during background refreshes.
- Keep the integration separate from intentionally removed legacy AI, reimbursement, vendor, and simulated fulfillment code. Do not restore those features.
- Start with the Allocard Purchasing Research Agent, scoped to business software and subscriptions.
- Use a hybrid adapter: limited AI interpretation and comparison, deterministic authorization and execution coordination.
- Start with one testnet adapter signing account shared across employees, with a distinct child permission for each employee and company context.
- Grant spending authority rather than transferring the employee's whole allowance to an adapter wallet.
- Require employee confirmation of the exact task, worker, price, currency, and deadline before a paid submission.
- Enforce the demo route allowlist on the server: external workers are discovery-only and paid hiring, payment signing, and marketplace funding are disabled.
- Present the direct demo worker as **No marketplace charge**, not as universally free; model and hosting costs remain.
- Do not claim a provider is the best available agent. Show the selected candidate, the comparison criteria, and relevant evidence.

## 3. Actors and trust boundaries

| Actor | Responsibilities |
| --- | --- |
| Company owner | Grants the employee allowance, permits redelegation, approves adapter use, and can revoke future treasury authority. |
| Employee | Defines a task, delegates a narrower permission, reviews the proposal, and confirms or rejects it. |
| Allocard adapter | Discovers workers, validates quotes and permissions, submits approved requests, tracks jobs, and reconciles outcomes. |
| Allocard-owned demo worker | Runs on Vercel; returns actual results to Allocard for direct jobs and submits deliverables to Agent Market only for genuine marketplace assignments. |
| Marketplace owner/operator | Owns the listing and configures the Vercel deployment, marketplace webhook, and credentials once. Direct demo jobs require employee confirmation, not per-job owner approval. |
| NEAR Agent Market | Supplies listing discovery, marketplace job state, execution coordination, and the selected payment workflow. |

The adapter and demo worker are separate roles, even if their first deployments share infrastructure. The worker credential must not become a buyer credential or a company spending key.

The adapter must not expose employee wallet secrets, owner OAuth credentials, worker tokens, or payer keys to marketplace workers or a language model.

### 3.1 Hybrid adapter architecture

The adapter coordinates work; the worker performs it. They need not be two general-purpose AI agents.

| Responsibility | Implementation |
| --- | --- |
| Interpret the employee request | A limited AI call extracts structured requirements, desired output, constraints, and purchasing budget. Ask for clarification when required information is missing. |
| Discover marketplace workers | Application code queries the real catalog and records relevant listing evidence. |
| Filter and compare candidates | Deterministic filters enforce capabilities, company policy, availability, and execution eligibility. AI may explain differences without overriding exclusions. |
| Validate authority and budgets | Deterministic server code checks identity, membership, permissions, expiry, reservations, and limits. |
| Prepare and bind approval | Application code creates an immutable proposal and records the employee's confirmation of that exact proposal. |
| Dispatch and authorize payment | Application code controls the allowed endpoint, execution mode, funding, and signing. The model cannot authorize these operations. |
| Track and reconcile work | Application code persists IDs and state, validates events, retrieves results, and applies route-specific retry rules. |
| Perform purchasing research | The owned worker uses its model and approved search/retrieval tools to produce a sourced comparison. |

Flow: `employee prompt → structured requirements → catalog search and hard filters → proposal → employee confirmation → permission recheck → dispatch → worker execution → status and results`.

Implement the first adapter primarily as automated application code, with a small prompt-to-requirements step and optional candidate explanations. Keep heavier research in the worker. Validate model output against a schema and treat it as untrusted input. Neither model can access signing keys or change an approved task, amount, worker, network, or execution route.

### 3.2 Adapter account and shared signer

The adapter is the named delegate on a child permission issued under the employee's permission. For on-chain execution it has a NEAR account and a signing key held by a protected signing service. Its account identifies the executor; the child permission identifies the authority being exercised.

```text
Company treasury
├── Alice's employee permission
│   └── Child permission A → adapter account, limit 1 NEAR
└── Bob's employee permission
    └── Child permission B → same adapter account, limit 2 NEAR
```

Funds remain in the company treasury. Creating either child permission does not transfer its limit to the adapter wallet. Revoking Alice's permission must not remove Bob's independent permission, and Bob's allowance must never authorize a job bound to Alice.

Use one adapter signing account for the initial testnet demo, with separate child permissions for each employee and company context. Do not reuse an employee's personal key. The signer is distinct from the Vercel worker's model credentials, marketplace worker token, and any future x402 payer account.

Direct research execution does not itself require a wallet or on-chain debit. The demo still creates and checks the real child-permission relationship, but it does not claim that contract execution enforces a zero-charge HTTP call. The backend checks that authority before dispatch. The worker needs no wallet simply to research and return results.

The actual child-permission creation remains an employee-authorized on-chain operation; it is not silently signed by the shared adapter. Testnet network/sponsorship setup must support that operation. Provision the adapter's signing capability only for the operations it actually exercises and keep the key outside the worker runtime where possible.

A separate x402 payer account, if later chosen, requires the production funding and custody design in section 4.3. Having an adapter account does not automatically enable treasury-funded marketplace purchases.

### 3.3 Concurrent employee jobs and isolation

One signer can act under multiple permissions; a wallet per employee or task is not required. Research jobs can execute concurrently without serializing model calls behind the signing account.

Every job and execution record must bind company ID, employee ID, parent permission ID, child permission ID, adapter signer, immutable proposal digest, and unique request ID. Derive or validate that binding on the server. Never let the browser or model choose an unrelated permission ID.

The treasury verifies the supplied permission and its ancestry. Because the shared signer may hold authority under multiple employees' permissions, Allocard must separately enforce which permission belongs to the requesting employee. On-chain signer verification alone does not provide that application-level isolation.

When transactions use a shared signer:

- Coordinate access-key nonces through a durable transaction queue or allocator with cross-process locking. Do not independently fetch and reuse a nonce in concurrent functions.
- Persist transaction intent and signed bytes before broadcast; apply existing execution request-id and reconciliation protections.
- Reserve relevant budgets atomically, accounting for shared parent limits as well as individual child limits.
- Isolate quotas, query caches, status reads, artifacts, cancellations, and audit history by company and employee.
- Keep permission selection and approval binding outside AI control.

A shared signer is a larger compromise domain. A later production deployment may isolate signers per company or signer shard while preserving the same job and permission model. Key rotation must account for delegate identity: do not silently switch to a new account without updating or replacing affected permissions.

## 4. Integration modes

### 4.1 Direct Vercel demo with marketplace discovery

Deploy the owned agent through the marketplace's Vercel hosting option or an equivalent controlled Vercel project. The official template is designed for signed marketplace webhooks and marketplace assignments. A direct Allocard job endpoint is additional implementation; do not assume the template includes it.

The deployment has two separate entry points that share a task execution core:

| Entry point | Authentication and behavior |
| --- | --- |
| Allocard direct endpoint | Server-to-server authenticated requests from the Allocard adapter. Creates an Allocard-owned job and reports status/results directly to Allocard. No marketplace approval or payment. |
| Marketplace webhook | Validates the marketplace signature and processes genuine marketplace assignments through the documented worker lifecycle. |

Requirements:

- Employees remain ordinary Allocard users. Every request passes company membership, delegation, capability, and confirmation checks before dispatch.
- Search the public marketplace catalog for relevant agents. External results show their listed prices and capabilities but have no executable paid route in demo mode.
- Present the configured Allocard demo worker separately. It is the only enabled execution route, and only for tasks its backend actually supports.
- The employee sees the exact worker, task, deadline, required access, and **No marketplace charge** before confirming.
- Direct requests must never depend on a marketplace draft, `approval_url`, owner OAuth session, or `test_run: true`. Do not invoke marketplace hiring to start them.
- A direct request has an Allocard/Vercel job ID, not a fabricated marketplace assignment ID. Status and deliverables come from the direct job store and worker.
- No company funds are transferred, no payment authorization is signed, no marketplace funds are held, and the worker receives no marketplace payout for direct demo jobs.
- Hosting, model, and external tool costs can still apply. Configure execution quotas, model/tool budgets, and rate limits independently of the employee's nominal allowance.
- Do not let the demo worker hire paid external agents or purchase tools through a marketplace connection. Allow only explicitly configured internal tools within the operator's usage budget.
- If discovery is unavailable, show a discovery error with retry. The configured direct worker may remain available, but do not fabricate marketplace results.
- If direct execution fails, show the real failure. Do not silently reroute to paid marketplace execution or substitute a canned result.

The demo proves live marketplace discovery, narrower delegation, employee confirmation, direct task execution, status tracking, and actual delivery. It does not prove marketplace job creation, marketplace escrow, settlement, disputes, or refunds.

### 4.1.1 Optional owner test workflow

The owner may separately run `test_run: true` to validate the agent's marketplace webhook integration. Its documented marketplace approval page still applies. This is an optional operator check, not a dependency of the employee demo and not a way to grant arbitrary employees free marketplace hiring.

### 4.1.2 Vercel deployment and runtime

- Start from the documented marketplace Vercel template after inspecting its actual interfaces. Configure `MARKET_AGENT_TOKEN`, `MARKET_WEBHOOK_SECRET`, and `NEARAI_API_KEY` where the template requires them; keep all credentials server-only.
- Add a separate direct-request authentication secret or validated service identity. Marketplace webhook credentials and worker tokens must not authenticate direct employee requests.
- Validate direct request origin through service authentication, not a caller-supplied employee ID. The Allocard adapter remains the authority for company and employee access.
- Keep direct-job context separate from marketplace assignments. Direct execution must not use assignment-scoped marketplace tools or submit its result to the marketplace.
- Reuse the execution core, instructions, and supported tools across entry points, while keeping job IDs, credentials, status sinks, and completion handlers distinct.
- Persist jobs, idempotency records, events, and artifacts outside process memory and ephemeral local disk.
- Use durable execution/queues for tasks that exceed an individual function lifetime. Return a job ID quickly, then poll or consume authenticated updates; do not rely on an open HTTP request or an untracked background promise.
- Configure deployment protection so signed marketplace webhooks and authenticated Allocard requests reach only their intended handlers. Do not expose a public anonymous model endpoint.
- Track Vercel and model usage and choose a plan suitable for the deployment's use. Vercel hosting does not make model execution free.

### 4.2 Production account-based hiring

Use the marketplace's current buyer connection and draft/approval workflow if retaining an external approval page is acceptable.

Employee confirmation inside Allocard and marketplace approval are separate events. Marketplace funds are held outside Allocard's treasury; Allocard must track that balance and prevent its credentials from bypassing employee limits.

Do not implement against outdated direct-hire SDK methods without checking the live interface.

### 4.3 Production wallet-based hiring

A2A + x402 is the intended investigation path for employee confirmation entirely within Allocard, followed by adapter payment authorization and task submission.

The documented NEAR payment is a signed delegated USDC `ft_transfer`, not an Allocard treasury permission. This incompatibility is a release gate, not an implementation detail to assume away.

Choose and document one payment architecture before enabling paid jobs:

1. A validated custom marketplace/facilitator integration accepting a treasury-compatible payment authorization; or
2. A separately funded signing account with minimal per-job funding, explicit custody boundaries, controlled settlement, and return-of-funds reconciliation.

For option 2, funds already moved to that account are outside the existing treasury's direct enforcement. Revoking a treasury permission cannot automatically revoke a payment authorization already signed by that account. Document and test this exposure before release.

Keep direct demo jobs, optional marketplace owner tests, account-balance hires, and x402 tasks as distinct execution modes. Direct mode must not instantiate a payment-capable connector.

## 5. Employee experience

1. Open the adapter from the existing delegation interface.
2. Review or create its child permission: asset, maximum spend, expiry, recipients, and any execution limits.
3. Enter a task and the desired deliverable, with optional deadline and supported attachments.
4. See related marketplace candidates and their listed prices. In the demo, these are discovery-only; choose the separately identified Allocard demo worker if it supports the task. Receive its exact brief, delivery window, required access, and **No marketplace charge**. Paid modes additionally require a current quote and currency/network.
5. Confirm or reject. An edit affecting task, worker, price, network, access, or deadline invalidates the previous confirmation.
6. Follow the job in Allocard. In direct demo mode, confirmation immediately dispatches to Vercel without another owner approval. Show progress, delays, failures, and next actions. Marketplace approval requirements appear only in modes that actually require them.
7. Read or download the actual deliverable. Where supported by the chosen marketplace flow, accept, request changes, or open the marketplace dispute page.

The demo must visibly state: **Direct demo execution — no marketplace charge**. Marketplace candidate prices are reference prices, not charges for the direct job. If evaluating a nominal job cost, label it as simulated authorization; settled spend remains zero. Creating a real child permission is an on-chain operation and can still incur network/sponsorship costs; the zero-charge claim applies to marketplace execution.

There is no owner-approval link or waiting-for-owner step in the direct employee flow. Such links belong only to optional owner tests or account-based marketplace modes and must follow their own authorization rules.

## 6. Discovery and selection

Demo and production discovery use the public agent catalog, filtered through a company-approved provider policy. Discovery eligibility does not imply execution eligibility.

Evaluate candidates on:

- Task and output-format compatibility.
- Availability and delivery SLA.
- Exact current price and supported payment route.
- Required connectors and the sensitivity of task inputs.
- Completed-job evidence, review history, success rate, and sample size.
- Company exclusions and approved-agent restrictions.

Rank deterministically where possible. An optional model can classify a task or summarize candidate differences, but it must not authorize spending or override hard exclusions. Store the scoring-policy version and proposal evidence.

Revalidate price and availability before submission. A changed quote requires a new proposal and confirmation; do not silently pick a different worker.

In the first demo, display genuine related marketplace results with paid execution disabled, and route supported requests only to the configured Vercel worker. Enforce this choice server-side even if a client submits an external agent ID or URL. Show the owned agent as a configured direct demo worker, not as a winner of a fabricated marketplace comparison. Its listing ID is optional metadata for direct execution, not proof that a marketplace job exists. For unsupported tasks, return a clear explanation instead of inventing a fulfillment result.

## 7. Delegation and authorization

- Verify the authenticated Privy identity, wallet, active company membership, and employee role on the server for every operation.
- Bind every request to company, employee, parent permission, child permission, and adapter signer.
- Reuse the treasury's child-permission narrowing rules. Never widen an asset, recipient, amount limit, expiry, execution count, or redelegation depth.
- Recheck effective permission state before dispatching direct work and before any irreversible funding or signing operation. A cached balance or browser-supplied permission is not proof.
- Bind approval to an immutable proposal digest including the brief, attachment hashes, provider ID, price, currency/network, quote expiry, permission reference, and approval expiry.
- Record revocation and block uncommitted work. Attempt marketplace cancellation only when supported; do not promise to cancel work that has started or recall a committed payment.
- Explicitly allowlist payment networks, token contracts, and payment recipients. Verify x402 requirements against the configured marketplace deployment.

An on-chain recipient restriction cannot identify a particular worker when multiple workers share a marketplace payee. Worker selection and task restrictions require adapter enforcement unless a validated protocol extension provides those guarantees.

Never give an external worker an unrestricted Allocard permission merely because it has a marketplace listing.

## 8. Budget accounting

Keep these concepts distinct:

| State | Meaning |
| --- | --- |
| Available | Allowance not consumed or reserved by active authorized work. |
| Reserved | Allocard has committed part of an allowance to an approved request. |
| Funding pending | A funding operation was submitted but its outcome is not yet known. |
| Authorized | A payment authorization exists and may still settle. |
| Held | The selected marketplace flow confirms money is held for the job. |
| Settled | The payment outcome is confirmed under the selected payment route. |
| Refund pending | A refund is expected or attempted, but receipt is not confirmed. |
| Refunded | The actual refund destination and amount are confirmed. |

Reserve budgets atomically across concurrent jobs. Combine existing contract usage and adapter reservations without double-counting the same debit. A read-then-write allowance check is insufficient.

Use integer token units and explicit asset metadata: native NEAR uses 24 decimals; configured USDC uses its verified decimals. Never assume NEAR and USD have equal value. If conversion is required, bind the conversion quote and maximum debit to employee approval.

Define reservation behavior separately for each payment route. Keep a reservation while an authorization can still settle or a submission is ambiguous. Release only after a conclusive terminal outcome or confirmed expiry/reconciliation.

For direct demo jobs, record nominal budget checks separately from real ledger usage. Do not deduct settled spend, create payment holds, or transfer company funds for direct execution. Enforce separate concurrency and resource quotas so a zero-price job cannot consume unlimited model usage. After a direct job is dispatched, revocation blocks new work and requests cancellation where supported; it cannot guarantee reversal of already consumed compute.

Refunds to a marketplace account are not treasury receipts. Do not restore treasury liquidity simply because a marketplace job was cancelled. Track refunds where they actually arrive, including partial refunds and fees.

## 9. Job and payment state machines

Maintain separate request, marketplace, and financial states. A single `success` boolean is insufficient.

Request flow:

`draft → selecting → awaiting_employee_confirmation → approved → submitting → running → delivered`

Direct demo jobs use this flow without an owner-approval state. Their financial mode is `not_applicable`, with marketplace charge and settled spend zero. Keep infrastructure usage separate.

Additional mode-specific states include `awaiting_owner_approval`, `awaiting_marketplace_approval`, `changes_requested`, `cancellation_requested`, `cancelled`, `failed`, and `needs_reconciliation`.

Store raw provider state and derive the Allocard view through a versioned mapping. Do not label delivered work as accepted or payment as settled without the evidence required by that route.

- Account-based hires can require deliverable review and have an automatic acceptance window. Track the actual deadline and notify the reviewer.
- x402 tasks settle on delivery according to the documented route. Do not advertise an account-hire review/refund window for these tasks without separate verification.
- A response timeout is not a failed payment or failed job.
- A cancellation request is not proof of cancellation or refund.
- Progress percentages are displayed only when supplied by a reliable source; otherwise use descriptive states and timestamps.

## 10. Reliability and reconciliation

- Create a durable Allocard request ID before contacting any execution provider.
- For direct Vercel jobs, enforce a persistent unique idempotency key scoped to company and request. The same approved intent returns the same job; a changed payload with the same key is rejected. Following an uncertain submission, query that job by its idempotency identity rather than starting a second run.
- Verify authenticated direct-worker events, enforce monotonically versioned state, and provide a company-scoped status read. Do not expose the worker endpoint or artifacts through an unrestricted client proxy.
- Use the documented MCP `client_request_id` consistently when replaying preparation of the same draft. Changed intent requires a new ID and confirmation.
- Persist external draft, job, assignment, task, and context IDs as applicable. Treat task IDs as sensitive when they act as retrieval capabilities.
- Store signed payment authorization and its intent before submission where relevant. Never automatically sign another payment following a timeout.
- Follow route-specific retry rules. In particular, x402 facilitator errors and replay rejection are different cases; do not implement a generic POST retry policy.
- Prefer immediate task-ID return when the x402 interface supports it, then poll status. This reduces but does not eliminate lost-response risk.
- If payment submission may have succeeded but its task ID was lost, mark `needs_reconciliation` and block replacement payment until resolved. Paid release requires a validated recovery procedure.
- Validate signed worker webhooks against raw bytes and timestamp, deduplicate deliveries, and tolerate out-of-order events. Worker webhook support does not imply equivalent buyer webhook support.
- Re-read authoritative job state after events. Keep a bounded polling fallback through the credentials available to the selected route.
- Use a durable queue/worker for long-running work. Do not depend on an HTTP request remaining open or on untracked background promises after a serverless response.

## 11. Application interfaces and data

Implement a marketplace provider interface with explicit capabilities: search, quote/prepare, approval requirements, submit, status, deliverable retrieval, cancellation, and reconciliation. Expose unsupported capabilities rather than faking them.

Use separate implementations for `direct_vercel_demo`, optional `marketplace_owner_test`, `marketplace_account`, and `marketplace_x402` flows. Their shared task UI must not erase their financial differences.

Proposed internal operations:

- Search approved workers.
- Create a task and obtain a proposal.
- Confirm or reject a proposal.
- Submit the approved direct job to the authenticated Vercel endpoint and retrieve its durable job ID.
- Prepare and check external approval only for marketplace flows that require it.
- Read a task's status, history, deliverables, and financial state.
- Request cancellation or route to marketplace review/dispute where supported.
- Receive signed events for the owned worker.

All reads and writes require company-scoped authorization. Keep marketplace credentials server-side. Do not expose an unrestricted proxy to the marketplace API.

Proposed persistence:

| Record | Minimum contents |
| --- | --- |
| Marketplace connection | Company/operator ownership, mode, credential reference, permitted capabilities, revocation state. |
| Worker configuration | Execution mode, optional marketplace listing ID, configured Vercel origin, credential reference, approved capabilities, runtime, demo ownership. |
| Adapter delegation | Parent/child permission references, adapter signer, company and employee binding. |
| Task and proposal | Immutable approved intent, quote evidence, digest, approval identity/time, external IDs, state and deadlines. |
| Reservation/payment | Asset, amount, permission linkage, idempotency key, authorization reference, funding and settlement evidence. |
| Event/deliverable | Provider event ID, verified source, state version, artifact metadata, checksum, access policy. |
| Reconciliation record | Ambiguity, attempted recovery, confirmed outcome, operator action and audit evidence. |

Use additive migrations. Do not drop historical tables or reinterpret legacy amounts. Secret material belongs in protected credential storage, not ordinary task JSON or logs.

## 12. UI and data handling

- Add an adapter task panel using existing shadcn dialogs, cards, forms, tables, badges, and alerts with monochrome styling.
- Show delegation limits, selected worker, price, employee approval, mode-specific external approval where applicable, execution state, and deliverable as separate facts.
- Keep the actual dashboard visible during fetches. Skeletonize missing values and rows only.
- Scope query keys by identity, network, company, employee where applicable, and task ID. Clear private caches on identity changes.
- Invalidate related task, allowance, treasury, and activity queries at confirmed state transitions. Use short post-settlement refreshes for read visibility.
- Do not enable automatic mutation retries for payment, funding, hiring, or deliverable acceptance.
- Render worker text as untrusted content. Sanitize Markdown, validate links and downloads, and never execute instructions embedded in a worker response.
- Limit attachment types and size; use signed access, checksums, retention rules, and explicit consent before sharing sensitive company information.

## 13. Owned worker scope

The first worker is the **Allocard Purchasing Research Agent**, initially limited to business software and subscriptions. It researches and recommends; it does not purchase, subscribe, create vendor accounts, accept contracts, or provision services.

Example request:

> Find three project-management tools for a team of 12. Our budget is $100 per month. We need time tracking and guest access.

Required inputs include the product category, team size, must-have features, purchasing budget and currency, billing preference, and any region or company-policy constraints. Ask for missing information that materially changes the comparison instead of guessing.

The deliverable must contain:

- Up to three suitable options, or a clear explanation when fewer qualify.
- Source links to vendor product, feature, and pricing pages, with retrieval dates.
- Published prices, currency, billing interval, per-seat assumptions, relevant plan, and estimated team total. Identify annual-billing requirements, taxes, promotions, and uncertain costs explicitly.
- A comparison against each stated requirement, separating verified facts from unknowns.
- A recommendation with tradeoffs, assumptions, and any remaining verification needed before purchase.

Use an approved web-search/retrieval tool to check current sources. Do not rely solely on model memory or fabricate citations, prices, stock, or feature claims. If a source cannot be accessed, report the limitation. Prefer vendor sources for price and feature evidence.

The **purchasing budget** constrains the recommendation. The **agent execution budget** controls payment for agent work. The **infrastructure budget** controls model, search, and hosting usage. These are different amounts: asking for software under $100 per month does not authorize a $100 purchase or an agent fee. Direct demo marketplace charges remain zero.

Additional task handlers can be added later behind the same listing only when actually implemented, tested, and reflected in its capability description. Do not route arbitrary employee prompts to a worker that cannot perform them.

For direct jobs, the Vercel worker accepts authenticated requests, creates durable execution state, runs supported work, and returns progress and actual deliverables to Allocard. For genuine marketplace assignments, it follows the marketplace start, submission, and rework lifecycle. A marketplace listing alone does not supply an execution engine, and receiving a direct request must not trigger marketplace submission tools.

Demo deliverables must not fabricate purchases, bookings, credentials, financial transactions, citations, or external actions. Any simulated output must be explicitly identified as simulated.

## 14. Delivery milestones

### A. Validate the Vercel worker and discovery

Create the owned listing and deploy its agent to Vercel. Add an authenticated direct endpoint and durable job status/results. Complete one direct job without a marketplace draft or owner approval. Verify that live marketplace search returns real candidates and that only the configured Allocard worker is executable in demo mode.

Exit criterion: actual direct worker output, durable job recovery, authentic discovery results, and no marketplace debit. A separate owner-approved marketplace test may validate webhook wiring but does not gate the direct flow.

### B. Adapter and delegation demo

Add company-approved adapter configuration, employee child permission handling, task proposals, bound confirmation, server-enforced demo routing, status UI, and audit records. Keep marketplace execution spend at zero.

Exit criterion: an authorized employee completes a supported request end to end without a per-job owner approval; unauthorized, revoked, external-route, and paid-route requests are rejected.

### C. Production payment compatibility investigation

Resolve treasury-to-x402 compatibility, live supported assets/networks, funding custody, lost-response recovery, refund destinations, withdrawal access, and current commercial terms. Validate the chosen route against the live API rather than assuming the legacy SDK works.

Exit criterion: a documented payment design and verified reconciliation procedure, including ambiguous failures. Do not enable paid jobs before this gate.

### D. Paid pilot and broader selection

Run a deliberately small paid pilot with explicit operator authorization and limits. Enable paid execution for a curated subset of the workers already visible in discovery, with explicit mode-specific quotes and confirmation. Expand only after payment, task, cancellation, and reconciliation checks pass.

## 15. Acceptance and negative tests

- Both dashboards show request and job states with shadcn components and monochrome styling; canvas behavior remains available.
- An employee cannot use another company's connection, permission, job, or artifacts.
- A child permission cannot widen the parent's authority.
- Two employees can run jobs concurrently through the same adapter account using distinct child permissions.
- A request from Alice cannot select Bob's permission or access his task, artifact, reservation, or approval, even when both delegate to the same signer.
- Concurrent jobs sharing a parent allowance cannot exceed it; shared signer transactions do not collide on nonces.
- Revoking one employee's authority leaves unrelated employee jobs and permissions correctly isolated.
- Models cannot call the signer or override hard filters, execution routes, and proposal approval.
- Research results cite checked sources, distinguish pricing assumptions, and never perform or claim an actual purchase.
- Purchasing budget, agent fee, and infrastructure costs are represented separately.
- Revocation and expired permissions block uncommitted funding/signing.
- Quote changes and task edits invalidate prior confirmation.
- Simultaneous requests cannot exceed an allowance through a reservation race.
- Direct demo requests are clearly identified and produce no marketplace spend, marketplace draft, or fabricated assignment ID.
- Employee confirmation dispatches a direct job without requiring marketplace owner approval.
- Real related catalog results are visible, but direct execution accepts only the configured owned backend. Manipulated client URLs, worker IDs, and payment-mode flags cannot enable paid execution.
- Direct submission retries return the original job; a reused idempotency key with changed intent fails.
- Vercel restarts and request timeouts do not lose acknowledged jobs, status, or deliverables.
- Model/tool quotas and concurrency caps prevent unbounded usage even when the marketplace charge is zero.
- Optional owner tests retain marketplace approval and ownership restrictions; they are not used for ordinary direct demo requests.
- A confirmed draft is not duplicated by retrying preparation.
- A timeout never triggers a replacement payment automatically.
- Duplicate or reordered events do not create duplicate jobs, spend, or terminal transitions.
- Failed or unsupported cancellation does not display a refund.
- Refund pending, marketplace balance received, and treasury funds returned remain distinct states.
- Worker content cannot invoke funding, approve another hire, or acquire additional credentials.
- Missing marketplace approval, unavailable workers, rate limits, and unsupported tasks have clear recoverable states.
- Status polling stops at terminal states or enters a bounded reconciliation workflow.
- Tests distinguish mocked providers, actual direct Vercel execution, optional owner marketplace tests, and actual paid marketplace settlement.

## 16. Implementation prerequisites and setup checklist

Gather these before the integration work that depends on them. No funded mainnet wallet or USDC is needed for the direct demo.

| Item | Needed from the project owner | Implementation responsibility |
| --- | --- | --- |
| Initial capability | Confirm business software/subscription purchasing research and supply 3–5 realistic prompts with acceptable outputs. | Define the structured input/output contract and capability checks. |
| Marketplace listing | Sign in, accept applicable terms, create the owned agent, choose Vercel hosting, and provide its ID/handle. | Use listing metadata for discovery/display; direct execution does not depend on a marketplace hire. |
| Agent repository | Provide the repository created from the Vercel deployment template and authorize its modification. | Inspect the template and add the authenticated direct-job entry point alongside the marketplace webhook. |
| Vercel project | Provide project identity, deployment URL, and the access needed to configure deployment and environment variables. | Implement durable execution, deployment configuration, status/results, and operational checks. |
| Model credentials | Configure the selected model provider's key directly in server-side environment settings; the marketplace template uses `NEARAI_API_KEY`. | Integrate the model and enforce token/tool limits. Never place keys in prompts or client variables. |
| Search/retrieval tool | Supply a suitable provider account/key if the selected tool needs one. | Fetch current sources, constrain tool access, and preserve citation evidence. |
| Marketplace worker configuration | Store `MARKET_AGENT_TOKEN` and `MARKET_WEBHOOK_SECRET` in the Vercel project for its genuine marketplace integration. | Keep these separate from direct-job authentication and avoid marketplace tools for direct jobs. |
| Allocard-to-worker identity | Allow generation and configuration of a separate service secret or equivalent service identity on both deployments. | Authenticate direct submissions and updates, scope requests, and support rotation. |
| Delegation environment | Identify the existing testnet treasury/sponsorship setup. No employee private keys are requested. | Configure a dedicated adapter account, protect its key, and reuse employee-authorized child-permission creation. |
| Usage limits | Choose requests per employee, concurrency, task timeout, and an infrastructure/model/search spending ceiling. | Enforce limits across concurrent workers and expose useful errors. |
| Durable storage | Identify reusable database, artifact storage, and workflow/queue services available to the project. | Store jobs and idempotency state durably; avoid process-local state as the source of truth. |

Put secrets directly in protected deployment settings or an approved secret store; do not paste them into chat or commit them. Listing publication does not require special marketplace permission beyond the documented eligibility and setup requirements. Optional owner tests have separate ownership/approval rules and are not an employee demo prerequisite.

The repository implementation covers adapter coordination, delegation checks, real catalog discovery, employee confirmation, Vercel integration, job/status storage, dashboard UI, and meaningful tests. Account sign-ins, accepting provider terms, and supplying provider credentials remain owner setup tasks.

### 16.1 Supplied setup and repository inspection

The project owner confirmed the purchasing-research scope and supplied:

- Agent handle: `@purchasing-research-agent-v2`.
- Deployment: `https://purchasing-research-agent-v2.vercel.app`.
- Repository: `https://github.com/Stoneybro/purchasing-research-agent-v2`, default branch `main`.
- Marketplace webhook: `https://purchasing-research-agent-v2.vercel.app/market/webhook`.
- Eve connection command: `eve remote connect --url https://purchasing-research-agent-v2.vercel.app`.
- Vercel setup reported complete. The owner confirmed `NEARAI_API_KEY` is present in the agent deployment; successful model execution and provider capacity still require verification.
- Marketplace token and webhook secret were not made available to the owner during setup. Do not assume they are configured merely because a deployment URL exists.

Read-only inspection found the Eve marketplace template, pinned to Eve `0.76.0`, generic marketplace instructions, a marketplace channel/connection, and a NEAR AI Cloud model configuration using `NEARAI_API_KEY`. No purchasing-specific search/retrieval tool or dedicated direct Allocard job endpoint was present in the inspected tree.

The Eve connection command identifies a remote deployment; it is not a replacement for authenticated application-to-agent access. The webhook URL is not a general-purpose employee job endpoint.

Implement the direct demo as a separate authenticated channel/endpoint. It must run without invoking the marketplace connection or requiring marketplace worker credentials. Retain the marketplace webhook code, but make its missing configuration an isolated capability status. Check whether template channel/connection initialization must become conditional to allow the direct route to operate independently.

Configure a newly generated direct-service secret in both projects using protected environment settings. The owner confirmed `NEARAI_API_KEY` is present; verify that the chosen model can run before declaring the worker operational. Do not request secret values through chat. Marketplace token/secret recovery or rotation can be handled separately if genuine marketplace assignments are enabled later.

### 16.2 Judging-ready demo limits

The owner requested generous limits for an unknown number of concurrent judges. Account-specific provider capacity was not available from public documentation during implementation preparation. The initial proposal is reduced by at least half: 12 global and 2 per-employee concurrent jobs, 100 waiting jobs, 25 per-employee and 500 global jobs daily, and a USD 25 tracked daily ceiling. These defaults are configurable server-side; they are application targets, not claims of tested Vercel or model-provider capacity:

| Control | Initial setting |
| --- | --- |
| Requests | 25 executed jobs per employee per UTC day; 500 across the demo deployment per UTC day. Discovery/proposals have separate rate limits and do not count as executed jobs. |
| Concurrent execution | 2 running jobs per employee; 12 across the deployment. Additional accepted jobs wait in a durable queue of at most 100 jobs. Shared demo accounts must not serialize all judges behind one running job. |
| Queue deadline | Expire unstarted jobs after 10 minutes with a clear retry action; recheck authorization immediately before execution. Show queue position or a queued status rather than a stalled spinner. |
| Task execution deadline | 3 minutes after execution starts, with bounded per-call timeouts and cancellation handling. |
| Research scope | Up to 3 product options, 6 search requests, and 12 retrieved source pages per job. |
| Model usage | At most 6 model calls and cumulative limits of 40,000 input tokens and 8,000 output tokens per job, including the adapter's task interpretation. Enforce provider-specific context limits as well. |
| Infrastructure/model/search budget | Target a USD 25 daily ceiling for tracked variable usage. Reserve estimated cost before calls using verified current rates, reconcile actual usage, and stop new execution at the ceiling. If reliable pricing is unavailable, disable those calls rather than claim an enforceable dollar limit. |
| Marketplace charges | Zero; no paid hiring or payment signing in the direct demo. |

Before judging, load-test 12 simultaneous distinct jobs and repeated submissions through a shared demo identity. Verify queue fairness, duplicate suppression, durable status recovery, provider throttling/backoff, and visible queued states. Adjust actual execution concurrency to verified provider capacity while retaining the generous admission queue. Do not use a shared-IP rate limit low enough to block judges on the same network.

Count execution quotas only once per accepted logical job; idempotent retries and status polling do not consume another execution slot or daily job allowance. Reserve infrastructure cost atomically across concurrent jobs, and release unused reservations after reconciliation. Daily request allowances are upper bounds, not a promise that all jobs fit the daily dollar ceiling. Expose usage to the operator and notify at 50% and 80% of the ceiling so it can be adjusted before judging is interrupted; never silently exceed it.

The tracked dollar ceiling does not cap Vercel subscription charges, delayed provider billing, or untracked overhead. Configure provider/platform spending controls where available; token, tool, execution, and concurrency limits remain mandatory. Avoid promising an exact total invoice cap.

### 16.3 Initial acceptance prompts

Generate current, sourced answers rather than prewriting the results. The following prompts are the initial evaluation set:

1. **Project management:** Find three project-management tools for 12 people under USD 100 per month, with time tracking and guest access. Prefer monthly billing. Show the team total and explain any annual-billing assumptions.
2. **Customer support:** Compare three customer-support tools for three support agents under USD 75 per month. Require a shared inbox and a public knowledge base. Identify whether these features are included in the quoted plan.
3. **Scheduling:** Find three scheduling tools for five employees under USD 50 per month. Require Google Calendar integration, team scheduling, and monthly billing. Cite official feature and pricing pages.
4. **Constraint failure:** Find a paid design collaboration tool for 50 users under USD 5 per month total, with SSO. If no verified option meets every requirement, say so and explain which constraints need changing; do not invent a match.
5. **Unsupported action:** Purchase 12 licenses of the recommended project-management software using the company allowance. The agent must explain that it can research and recommend but cannot purchase, spend from the treasury, or create a subscription in this demo.

Pass criteria: current source links and retrieval times; accurate plan/seat/billing assumptions; requirements mapped to evidence; unknowns identified; a recommendation with tradeoffs; no fabricated purchase or marketplace execution; clear separation of software purchasing budget from agent and infrastructure costs.

## 17. Public interface findings and unresolved gates

Findings verified during research:

- The current buyer reference describes `prepare_job` and a marketplace approval page, including owner-authorized `test_run: true` and draft idempotency through `client_request_id`.
- The public x402 configuration advertised `near:mainnet`; generic protocol testnet support does not establish a marketplace testnet.
- The x402 route documents a signed token transfer and task polling, not Allocard permission verification.
- Legacy `/v1/services` returned 404; do not assume the official SDK's legacy service methods remain usable.
- The live platform configuration reported a 5% fee. Recheck configuration and applicable terms before a paid launch.

Still unresolved: a supported contract-compatible payment bridge, unattended budget-scoped buyer credentials, reliable recovery when a paid response loses its task ID, and supported unattended USDC withdrawal. These are paid-marketplace release gates, not blockers for direct demo execution. The Vercel template's direct-request interface is custom work to validate in milestone A. Do not infer unrestricted public free usage from owner tests or imply Vercel hosting removes marketplace approval requirements.

Sources, which must be rechecked at implementation time:

- [Marketplace buyer reference](https://market.near.ai/skill/mcp-buyer/SKILL.md)
- [Marketplace x402 caller reference](https://market.near.ai/skill/x402-caller/SKILL.md)
- [A2A and x402 hiring](https://docs.market.near.ai/a2a/hire-agent-using-x402)
- [Marketplace Vercel deployment guide](https://docs.market.near.ai/guides/deploy-on-vercel)
- [Vercel function execution limits](https://vercel.com/docs/functions/limitations)
- [Self-hosted worker integration](https://docs.market.near.ai/guides/self-hosted-agents)
- [Builder FAQ and eligibility](https://docs.market.near.ai/builders/faq)
- [Live OpenAPI specification](https://market.near.ai/openapi.json)
- [Live x402 networks and recipients](https://market.near.ai/.well-known/x402)
- [Live platform configuration](https://market.near.ai/v1/platform/config)
- [NEAR x402 exact-payment specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_near.md)
- [Official marketplace SDK](https://github.com/nearai/agents-market-sdk)

## Implementation and operational handoff

See [AGENT-ADAPTER-OPERATIONS.md](./AGENT-ADAPTER-OPERATIONS.md) for the implemented flow, configuration, previews and verification limits. Public provider documentation gives a default of 64 concurrent requests per model; account-specific capacity remains unconfirmed. The reduced limits above remain in effect. Each executed job conservatively reserves $0.25 against the $25 daily application budget, with no exact invoice reconciliation yet. Vercel Hobby dispatch uses active polling and worker callbacks; uninterrupted unattended processing requires an external scheduler. Marketplace credentials were found already configured on the worker project; they are not needed for the direct demo.

The shared identity is the permission's delegate, not a pooled employee bank account. Each employee's child permission and each request retain their own company, employee and parent permission bindings. In direct demo mode, NEAR permission is checked but no treasury payment is executed and no on-chain execution counter is incremented.
