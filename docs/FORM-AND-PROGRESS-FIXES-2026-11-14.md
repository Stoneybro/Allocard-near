# Form validation and operation feedback

NEAR recipient input is trimmed and lowercased before policy validation, review and signing. Mixed-case duplicates are detected after normalization. Direct payments also normalize the reviewed recipient, and email/account fields disable mobile autocapitalization. Protocol-level account validation remains strict. Optional payment-count validation now matches the contract's u32 limit. The form audit covered invitation, onboarding, policy, direct-payment and research-task entry points.

Both policy drawers use the compiler's explicit budget-only rule: “give 500 USDC to this agent/employee” defines a lifetime budget. Omitted optional rules remain empty. An agent still inherits mandatory employer restrictions during review; those restrictions do not have to be repeated in the prompt. Real NEAR AI calls passed for employee and agent budget-only policies, returning 500 USDC, no optional fields and no clarification questions, in approximately 5.8 and 4.0 seconds respectively.

Sign-in remains busy from opening Privy through wallet/session establishment and dashboard routing. Repeated login clicks are locked, cancellation releases the lock, and restoring a signed-in principal does not briefly expose the sign-in CTA. Employer and employee-agent revocations show an immediate loading toast and disabled busy controls until completion or failure.

Treasury setup reports checks, signature/confirmation, spending access, funding and dashboard refresh at their actual boundaries. Policy activation uses the same elapsed-time status component. Payment confirmation stays open and disabled while sending, with validation/signature/confirmation messages; confirmed settlement remains visible while history synchronizes. Status timers are scoped to mounted operations and add a short reassurance after 15 seconds. No artificial completion percentage is displayed.

Validation: all 505 tests in the full web suite passed, followed by the two added interaction regressions (507 distinct passing tests overall). Type checking passed. Targeted lint reported no errors and nine existing warnings. New checks cover canonical payment recipients, blocked duplicate payment confirmation, continuous sign-in feedback, cancelled login recovery and minimal policy validation.

Changes are deployed through Vercel independently of Git commits. Keep the local source changes in the next commit so subsequent Git deployments retain the fixes.

Production deployment: `dpl_CNrsSwmBmdunsmKdUCQ4yQTLE2Z2`, `READY`, aliased to `https://www.allocard.xyz`. Compilation, production type checking and page generation passed. Reload existing dashboard tabs before testing.
