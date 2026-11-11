import { expect, it } from "vitest";
import { companyDelegatedAmount } from "@/lib/delegation-accounting";
it("counts a company allocation once even when employees split it across agents and descendants", () => {
  const root = { id: "root", status: "active", delegatorType: "company", delegatorId: "company", parentDelegationId: null };
  const child = { id: "child", status: "active", delegatorType: "user", delegatorId: "employee", parentDelegationId: "root" };
  const rows = [root, child, { ...child, id: "grandchild", delegatorType: "agent", parentDelegationId: "child" }, { ...root, id: "revoked", status: "revoked" }, { ...root, id: "other", delegatorId: "other-company" }];
  const amounts = ["1000", "300", "100", "500", "999"];
  const caveats = rows.map((row, i) => ({ delegationId: row.id, caveatType: "nativeTokenTransferAmount", caveatValue: { maxAmount: amounts[i] } }));
  expect(companyDelegatedAmount("company", rows, caveats)).toBe(1000n);
});
