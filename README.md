# Allocard

## The problem

Current corporate expense systems are not suitable for cash-strapped small teams. They require teams to prefund employee expense cards, fragmenting and locking up valuable capital that may be needed for other team expenses. This is a problem we encountered as a small agency.

## The solution

Allocard is an in-house corporate expense system built specifically for small teams. It keeps company capital in one treasury and gives employees permission to spend within rules set by the team.

Teams control these permissions and can revoke unused allowances at any time, releasing the reserved funds for other expenses without needing an external provider.

## Try the demo

**Before you start:** You’ll need two email addresses you can access and two separate browser sessions: two browser profiles, or a regular window and an incognito window. One represents the employer; the other represents the employee.

We’re sorry for the extra setup. We chose this approach so you can experience both sides of Allocard as a company and its employee would.

1. **Create your company.** Open [allocard.xyz](https://allocard.xyz), click **Enter App**, and sign in through Privy using email or Google. Enter your company name and click **Create company account**.
2. **Activate the treasury.** Click **Activate your company account**. Once activation completes, your company treasury receives **2,000 test USDC**.
3. **Invite an employee.** Click **Add Employee** in the left sidebar and enter your second email address.
4. **Join as the employee.** Open Allocard in your second browser session and sign in with the invited email. On the onboarding page, click **Accept invitation** to enter the employee dashboard.
5. **Grant spending permission.** Return to the employer window. Click **Add delegation**, select the employee, and keep the prefilled policy. Click **Review policy**, review the limits, tick the confirmation checkbox, and click **Sign & activate on NEAR Testnet**.
6. **Make a payment.** Return to the employee window. Your allowance should now appear. Make a direct payment to `vendor.testnet` or `supplier.testnet`, the recipients allowed by the default policy. Choose an amount within its limits, then review and confirm the payment.
7. **Enable agent access.** Open the agent tab and click **Set up agent**. Review and activate its spending policy using the same confirmation process.
8. **Run research.** Click **Add agent**, keep the prefilled research brief, and click **Find agents**. Choose **Purchasing Research agent v2**, click **Hire**, then **Confirm and start**. Follow the task’s progress and open the completed research report.
11. **Revoke access.** Return to the company dashboard, open the employee’s or their agent’s spending policy, and click **Revoke access**, then **Confirm revocation**. Revoking the employee’s access also stops spending through their agents and releases the employee’s unused allowance back to the company’s unallocated funds. Revoking only the agent’s access leaves the employee’s own permission active.

The research demo runs without charging your treasury or creating a paid marketplace hire.

In-app guide cards walk you through the demo on your first visit.

## Built for small teams (how NEAR powers Allocard)

While building Allocard, we prioritized a lightweight corporate expense system, reliable delegation, and a simple user experience.

**Delegation and automated controls**

Our NEAR smart contracts let companies give employees permission to spend directly from the company treasury. Before releasing funds, the contract checks each payment against the spending rules. Employees can delegate narrower permissions to agents, which remain subject to the employee’s limits.

Teams can set total budgets, recurring allowances, per-payment caps, permitted recipients, transaction-count limits, and expiry dates. They can revoke employee or agent access at any time.

These controls automate routine expense management. A team lead can receive a 100-USDC weekly allowance within a 500-USDC total budget, without a new transfer each week. A project allowance can expire after 30 days, ending access and releasing unused funds without asking the employee to send money back.

**A simpler experience**

- **Email and Google sign-in:** Privy creates embedded NEAR accounts, removing the need to set up a separate wallet. Companies invite employees using only their email addresses.
- **Gas sponsorship:** Allocard covers gas for all transactions in the demo, using NEAR meta-transactions for user-authorized actions. Employers and employees don’t need to acquire or manage gas tokens.
- **Cross-chain funding:** We integrated Aurora Intents so teams can fund their treasury without manually swapping and bridging assets. The current testnet treasury uses test USDC; cross-chain funding is a mainnet integration.
- **Agent access:** Employees can discover and use agents from NEAR AI Market directly within Allocard. For this demo, they can run our Purchasing Research agent, listed on the marketplace, without a treasury charge.

Teams manage spending through familiar accounts, while the contracts enforce who can spend, how much, where, and for how long.

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

Automatic test-USDC funding requires a mock token that authorizes your relayer to mint. Treasury verification also requires the matching `packages/contracts/res/allocard_shared.wasm` artifact.

Apply the database migrations and start the app:

```bash
pnpm --filter @allocard/web run db:migrate
pnpm dev
```

Open `http://localhost:3000` and follow the demo walkthrough above. Research tasks require a configured worker that can reach your app’s callback endpoints.

### Verify the implementation

Run the SDK and application tests:

```bash
pnpm test
```

With Rust installed, run the contract unit tests:

```bash
cargo test --manifest-path packages/contracts/Cargo.toml --workspace --lib
```

## Hackathon scope and acknowledgments

Allocard was built for this hackathon. Its delegation model was inspired by MetaMask Delegation and implemented as native NEAR smart contracts. The web interface uses shadcn/ui components alongside the integrations described above. AI assisted with development of the contracts and web application.

## Hackathon tracks

- **Real-World Money:** Company expense payments from a shared treasury.
- **Autonomous Business:** Rule-based employee and agent spending, with recurring allowances and automatic expiry.
- **Agent Economy:** Employees can discover and run a research agent listed on NEAR AI Market.
- **AI Security & Defense:** Contract-enforced spending limits, recipient restrictions, expiry, and revocable permissions for employees and agents.
