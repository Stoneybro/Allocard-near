# Allocard

[Live app](https://allocard.xyz) · [Watch the demo](https://youtu.be/-zg-bYNrpVE) · [Demo post on X](https://x.com/useAllocard/status/2121416296466108729)

## The problem

Current corporate expense systems are not suitable for cash-strapped small teams. They require teams to prefund employee expense cards, fragmenting and locking up valuable capital that may be needed for other team expenses. This is a problem we encountered as a small agency.

## The solution

Allocard is an in-house corporate expense system built specifically for small teams. It keeps company capital in one treasury and gives employees permission to spend within rules set by the team.

Teams control these permissions and can revoke unused allowances at any time, releasing the reserved funds for other expenses without needing an external provider.

## Try the demo

**Before you start:** You’ll need two email addresses you can access and two separate browser sessions: two browser profiles, or a regular window and an incognito window. One represents the employer; the other represents the employee.

We’re sorry for the extra setup. We chose this approach so you can experience both sides of Allocard as a company and its employee would.

Guide cards in the app prompt your next step, making it easier to follow the demo across both windows. Open **Help & Demo Tips** anytime for instructions or to restart the guide.

1. **Create your company.** Open [allocard.xyz](https://allocard.xyz), click **Enter App**, and sign in through Privy using email or Google. Enter your company name and click **Create company account**.
2. **Activate the treasury.** Click **Activate your company account**. Once activation completes, your company treasury receives **2,000 test USDC**.
3. **Invite an employee.** Click **Add Employee** in the left sidebar and enter your second email. Invitations appear in-app; no email is sent.
4. **Join as the employee.** Open Allocard in your second browser session and sign in with the invited email. On the onboarding page, click **Accept invitation** to enter the employee dashboard.
5. **Grant spending permission.** Return to the employer window. Click **Add delegation**, select the employee, and keep the prefilled policy. Click **Review policy**, review the limits, tick the confirmation checkbox, and click **Sign & activate on NEAR Testnet**. The default policy reserves 500 USDC, allows 100 USDC per week, and caps each payment at 50 USDC. The treasury still holds 2,000 USDC; 1,500 remains unallocated.
6. **Make a payment.** Return to the employee window and check your spending capacity. Under **Direct payment**, enter 10 test USDC and `vendor.testnet` or `supplier.testnet`. Click **Review payment**, then **Confirm & Execute**. Wait for **Spend Settled on NEAR**; the treasury balance and remaining allowance decrease by 10 USDC.
7. **Enable agent access.** Open the **Agents** tab and click **Set up agent**. Review and activate its spending policy using the same confirmation process. The agent receives a narrower permission within the employee’s existing allocation.
8. **Run research.** Click **Add agent**, keep the prefilled research brief, and click **Find agents**. Choose **Purchasing Research agent v2**, click **Hire**, then **Confirm and start**. Follow the task’s progress and open the completed report to review its findings and source links.
9. **Revoke access.** Return to the company dashboard. In the delegation table, click **Revoke** on the employee’s or agent’s row, then **Revoke delegation** to confirm. Employee revocation also stops future spending through their agents and releases unused allowance. Agent-only revocation leaves the employee’s permission active. A research task already running may still finish.

## Built for small teams (how NEAR powers Allocard)

While building Allocard, we prioritized a lightweight corporate expense system, reliable delegation, and a simple user experience.

**Delegation and automated controls**

NEAR smart contracts [check each payment against the company’s spending rules](packages/contracts/treasury/src/policy.rs) before releasing funds. Employee allowances [reserve funds inside the treasury](packages/contracts/treasury/src/allocations.rs) rather than transferring them to personal wallets. Employees can grant agents narrower permissions within their allocation, with reserved budgets protected against competing spending.

Teams can set total budgets, recurring allowances, per-payment caps, permitted recipients, transaction-count limits, and expiry dates. They can [revoke employee or agent access](packages/contracts/treasury/src/lib.rs) at any time.

A team lead can be authorized to spend 100 USDC per week within a 500-USDC total budget, without repeated transfers. A project allowance can expire after 30 days, releasing unused funds without asking the employee to return money.

The company dashboard shows the [employee–agent delegation hierarchy and research activity](apps/web/components/delegation-cards-view.tsx) associated with an agent permission.

**A simpler experience**

- **Plain-English policy setup:** NEAR AI Cloud converts spending instructions into policy settings. Allocard [validates them and requests clarification](apps/web/lib/policy-review.ts) when needed. Users [review the settings before signing, or configure them manually](apps/web/components/policy-configuration-drawer.tsx).
- **Email and Google sign-in:** Privy [creates embedded NEAR accounts](apps/web/components/AuthProvider.tsx), removing the need to set up a separate wallet. Companies invite employees using only their email addresses.
- **Gas sponsorship:** Allocard covers gas for all transactions in the demo, using [NEAR meta-transactions](apps/web/lib/near-sponsored-action.ts) for user-authorized actions. Employers and employees don’t need to acquire or manage gas tokens.
- **Cross-chain funding:** We integrated [Aurora Intents](apps/web/components/aurora-intent-widget.tsx) so teams can fund their treasury without manually swapping and bridging assets.
- **Agent access:** Employees can [discover agents through NEAR AI Market](apps/web/lib/agent-adapter/catalog.ts) and run our marketplace-listed Purchasing Research agent within Allocard. It uses NEAR AI Cloud web search to produce [research reports with sources](packages/research-worker/api/index.ts).

**Current demo scope**

- Activation adds **2,000 test USDC**; the built-in faucet provides **1,000 more** when needed. Aurora Intents uses mainnet assets and cannot fund this testnet treasury.
- Our Purchasing Research agent is listed on NEAR AI Market and runs without a treasury charge in this demo. Other listings are browsable but cannot execute here.

## Run locally

Use Node.js 24 and the pnpm version specified in `package.json`. Run these commands from the repository root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

Configure `apps/web/.env.local` with:

| Purpose | Configuration |
| --- | --- |
| Database | `DATABASE_URL`: a Neon Postgres connection |
| Sessions | `SESSION_SECRET`: a random secret of at least 32 characters |
| Sign-in | `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`; enable email, Google, and embedded NEAR accounts in Privy, and allow `http://localhost:3000` |
| Treasury | `SHARED_TREASURY_ACCOUNT_ID`: a compatible schema-5 testnet treasury; `NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID`: its spending token |
| Gas sponsorship | `NEAR_SPONSOR_ENABLED=true`, `NEAR_SPONSOR_COMPANY_ENABLED=true`, and a funded testnet relayer’s `NEAR_RELAYER_ACCOUNT_ID` and `NEAR_RELAYER_PRIVATE_KEY` |
| Policy interpretation | `NEAR_AI_API_KEY` |
| Agent research | `NEAR_ADAPTER_ACCOUNT_ID`, `ALLOCARD_AGENT_URL`, and `ALLOCARD_AGENT_SECRET`, matching the research-worker configuration |

For the [treasury, mock token](docs/delegation/SHARED.md), [relayer](docs/delegation/SPONSORSHIP.md), and [research worker](docs/AGENT-ADAPTER-OPERATIONS.md), follow the linked setup guides. Automatic test-USDC funding requires a token that authorizes your relayer to mint. Treasury verification uses the matching `packages/contracts/res/allocard_shared.wasm` artifact included in this repository.

Apply the database migrations and start the app:

```bash
pnpm --filter @allocard/web run db:migrate
pnpm dev
```

Open `http://localhost:3000` and follow the demo walkthrough above. Research tasks require a configured worker that can reach your app’s callback endpoints.

### Verify the implementation

See the [verification guide](docs/VERIFICATION.md) for implementation pointers, test coverage, and end-to-end verification steps.

Run the SDK and application tests:

```bash
pnpm test
```

With Rust installed, run the contract unit tests:

```bash
cargo test --manifest-path packages/contracts/Cargo.toml --workspace --lib
```

## Hackathon scope and acknowledgments

Allocard was built for this hackathon. Its delegation model was inspired by MetaMask Delegation and implemented as native NEAR contracts. The interface uses shadcn/ui components. AI assisted with contract and web-app development.

## Hackathon tracks

- **Real-World Money:** Company expense payments from a shared treasury.
- **Autonomous Business:** Rule-based employee and agent spending, with recurring allowances and automatic expiry.
- **Agent Economy:** Employees can discover and run a research agent listed on NEAR AI Market.
- **AI Security & Defense:** Contract-enforced spending limits, recipient restrictions, expiry, and revocable permissions for employees and agents.

## The team and what’s next

I’m Zion Livingstone, product lead at Oasis and Brooks, the team behind Allocard.

We intend to continue building Allocard beyond this hackathon. Our experience managing expenses as a small agency shapes the product, and we’ll keep working with other small teams to understand what they need.

The current prototype establishes delegated spending for onchain expenses. Next, we plan to explore virtual cards and merchant-payment integrations so teams can use Allocard for more of their everyday spending.
