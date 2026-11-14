# Client behaviour and trust boundaries

## Authentication and invitations

Privy email/Google is the app's login path. It creates or reuses an embedded NEAR account. Server verification binds the Privy identity, verified email, signing account, and company membership. Ethereum and Solana wallet auto-creation are disabled; EVM packages in indirect dependencies are not the delegation engine.

Opaque HttpOnly cookies reference hashed server-side sessions with absolute and idle expiry. Logout revokes the corresponding Privy app sessions. Account changes clear private queries. Configure both Privy app IDs consistently and keep its secret server-only. An optional public JWT verification key avoids the initial JWKS fetch and must follow key rotation.

Employers invite a verified email inside Allocard and share the app URL manually. No invitation email is delivered. The invited user accepts the company in onboarding; an invitation does not grant spending permission by itself.

## Reads and policy review

TanStack Query keys include identity, signing account, network, and company. Dashboards refresh on window focus, explicit refresh, or confirmed writes; there is no idle full-dashboard polling. Visible unfinished research tasks poll for progress. Payment mutations are never automatically retried as new payments.

NEAR AI proposes structured policy settings. The review gate validates them, asks for clarification when necessary, and rejects deterministic fallback results in the AI activation path. Manual configuration has the same review and acknowledgement requirement. The contract, not the model or cache, authorizes payments. Qualitative purpose and receipt instructions are advisory.

## Money and recovery

The demo uses six-decimal mock USDC; native NEAR uses 24 decimals. Legacy SQL names such as `amount_eth` remain for compatibility and do not determine the asset. Amounts and chain identity must be interpreted using the configured asset and verified treasury.

Allowances reserve company funds; agent allocations subdivide employee authority. See [accounting](delegation/RESERVATION-RELEASE.md). Capacity displays read contract state, while execution rechecks the live rules.

A draft is not a submitted transaction. Pending payment records retain original request details and transaction identities across retries. Preparation errors can leave an editable draft; ambiguous submission cannot be relabelled as failure. Confirmed settlement can be displayed while history synchronizes, without resending payment.

Legacy reimbursement/fulfillment routes are not part of this demo; company and employee dashboard state marks reimbursements unavailable. Historical records and schema compatibility remain. Do not remove database migrations or recovery artifacts just because the UI no longer offers an old flow.

See [walkthrough checks](delegation/TODAY.md) and [sponsorship recovery](delegation/SPONSORSHIP.md). Mocked client tests do not establish successful live sign-in or settlement.
