import { describe, expect, it } from "vitest";
import { resolveEmployerRevocation, type RevocationDelegation } from "@/lib/employer-revocation";
const root: RevocationDelegation = { id: "root", delegatorType: "company", delegatorId: "company", delegateeType: "user", delegateeId: "employee", parentDelegationId: null, status: "active", delegationHash: "1", treasuryReference: "treasury" };
const child: RevocationDelegation = { ...root, id: "child", delegatorType: "user", delegatorId: "employee", delegateeType: "agent", delegateeId: "agent", parentDelegationId: "root", delegationHash: "2" };
const resolve = (rows: RevocationDelegation[], id = "child") => resolveEmployerRevocation(id, "company", "treasury", async key => rows.find(row => row.id === key));
describe("employer agent revocation scope", () => {
  it("authorizes the child path without changing the employee or sibling", async () => {
    const sibling = { ...child, id: "sibling", delegationHash: "3" };
    const rows = [root, child, sibling];
    expect((await resolve(rows)).map(row => row.id)).toEqual(["child", "root"]);
    expect(rows.every(row => row.status === "active")).toBe(true);
  });
  it("supports deeper agent descendants", async () => {
    const grandchild = { ...child, id: "grandchild", delegatorType: "agent", delegatorId: "agent", parentDelegationId: "child", delegationHash: "3" };
    expect((await resolve([root, child, grandchild], "grandchild")).map(row => row.id)).toEqual(["grandchild", "child", "root"]);
  });
  it("rejects another company's branch", async () => { await expect(resolve([{ ...root, delegatorId: "other" }, child])).rejects.toThrow("another company"); });
  it("rejects a different treasury", async () => { await expect(resolve([root, { ...child, treasuryReference: "other" }])).rejects.toThrow("this treasury"); });
  it("rejects forged issuer ancestry", async () => { await expect(resolve([root, { ...child, delegatorId: "outsider" }])).rejects.toThrow("issuer ancestry"); });
  it("rejects missing parents", async () => { await expect(resolve([child])).rejects.toThrow("not found"); });
  it("rejects ancestry cycles", async () => { await expect(resolve([{ ...child, parentDelegationId: "child", delegatorType: "agent", delegatorId: "agent" }])).rejects.toThrow("Invalid delegation ancestry"); });
  it("does not grant removal of pending child agents", async () => { await expect(resolve([root, { ...child, status: "pending_config" }])).rejects.toThrow("Only active child agents"); });
  it("preserves company root revocation", async () => { expect((await resolve([root], "root"))[0].id).toBe("root"); });
});
