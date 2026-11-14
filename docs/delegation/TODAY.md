# Walkthrough acceptance checks

The [root README](../../README.md#try-the-demo) is the user-facing walkthrough. These checks describe expected results for a fresh company using the default mock-USDC policy. They are a procedure, not a claim that a live two-account run has been performed.

## Preconditions

- Two accessible email accounts and separate browser sessions.
- A schema-5 shared treasury, matching WASM, and mock USDC whose minter is the configured relayer.
- Privy email/Google and embedded NEAR accounts configured for the app origin.
- Database migrations applied; funded relayer; both sponsorship flags enabled.
- NEAR AI credentials for policy interpretation; configured research worker and adapter for the research steps.

See [shared setup](SHARED.md), [sponsorship](SPONSORSHIP.md), and [research operations](../AGENT-ADAPTER-OPERATIONS.md). Users do not need personal gas funds for the sponsored demo.

## Expected sequence

1. Sign in, enter a company name, and select **Create company account**. The employer dashboard opens.
2. Select **Activate your company account**. Wait for activation and funding to finish. The treasury has 2,000 test USDC; registration reserves are separate from this spending principal. Retrying the same activation must not issue another activation grant.
3. Select **Add Employee** and enter the second email. No email is sent. In the other session, sign in with that email and select **Accept invitation** under **Join a company**; do not create another company.
4. Back in the employer session, select **Add delegation**, select the employee, and keep the default policy. Review and acknowledge it, then select **Sign & activate on NEAR Testnet**. The limits are 500 USDC lifetime, 100 USDC per week, 50 USDC per payment, only `vendor.testnet` and `supplier.testnet`, at most 20 payments, expiring in 30 days. Treasury principal remains 2,000 USDC; 500 is allocated and 1,500 is unallocated.
5. Focus the employee window. Under **Direct payment**, send 10 USDC to one permitted recipient using **Review payment** and **Confirm & Execute**. Wait for **Spend Settled on NEAR** and inspect its explorer link. Treasury principal is 1,990 USDC; the employee's lifetime remainder is 490 and weekly remainder is 90. The per-payment cap remains 50. Verify the recipient and actual contract execution, not just the toast.
6. Before agent setup, try 51 USDC or a disallowed recipient. The request must be rejected without a successful transfer or history entry.
7. Under **Agents**, select **Set up agent**, then review and activate its narrowed permission. Its allocation must fit within the employee's permission. Direct employee capacity can decrease because the agent reserves a subdivision; company principal does not move.
8. Select **Add agent**, **Find agents**, **Hire** for **Purchasing Research agent v2**, and **Confirm and start**. Check progress and the sourced report. This task does not debit treasury USDC or consume the on-chain payment counter. The company owner can inspect the agent's **View activity**.
9. In the company's delegation table, select **Revoke** on the agent row and confirm with **Revoke delegation**. The employee's own permission remains active. Revoke the employee row to stop its whole branch and release the unused company allocation. With just the earlier 10-USDC payment and no other activity, allocated funds become zero and unallocated funds become 1,990 USDC. A research task already running may finish.

## Recovery and isolation

- Cancel before signing: no permission should activate and no payment should settle.
- An uncertain payment retains the original request and transaction identity. Retry to reconcile it; do not clear browser storage to force a replacement.
- A settled payment whose history write failed must synchronize that execution without another payout.
- Only authoritative failure or proof that an expired request was unused permits replacing an uncertain request. Timeout alone is not proof.
- A company registration retry checks the existing deterministic company ID before requesting another deposit.
- Repeat with two companies when checking tenant isolation: permissions, payments, research, and history must not cross company boundaries.

Application tests mock external services. Contract unit tests simulate the runtime; sandbox tests execute compiled contracts locally. None alone establishes working live OAuth, provider availability, or testnet settlement.
