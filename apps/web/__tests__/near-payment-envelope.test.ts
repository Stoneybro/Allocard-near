import { describe, expect, it } from "vitest";
import { paymentActions, containsPaymentRequest } from "@/lib/near-payment-envelope";
const actor = "employee.testnet", treasury = "shared.testnet", companyId = "c".repeat(64), requestId = "b".repeat(64);
const call = { FunctionCall: { method_name: "execute", args: Buffer.from(JSON.stringify({ company_id: companyId, request: { request_id: requestId } })).toString("base64") } };
function transaction(sender = actor, receiver = treasury) {
  return { signer_id: "sponsor.testnet", receiver_id: actor, actions: [{ Delegate: { delegate_action: { sender_id: sender, receiver_id: receiver, actions: [call] } } }] };
}
describe("chain-verified payment envelopes", () => {
  it("binds a relayed payment to the inner employee, treasury, company and request", () => {
    expect(containsPaymentRequest(paymentActions(transaction(), actor, treasury), requestId, companyId)).toBe(true);
    expect(containsPaymentRequest(paymentActions(transaction(), actor, treasury), requestId, "d".repeat(64))).toBe(false);
    expect(containsPaymentRequest(paymentActions(transaction(), actor, treasury), "a".repeat(64), companyId)).toBe(false);
  });
  it("rejects a different delegate sender, target or outer receiver", () => {
    expect(paymentActions(transaction("attacker.testnet"), actor, treasury)).toEqual([]);
    expect(paymentActions(transaction(actor, "other.testnet"), actor, treasury)).toEqual([]);
    expect(paymentActions({ ...transaction(), receiver_id: "other.testnet" }, actor, treasury)).toEqual([]);
  });
  it("does not accept a relayer's unsigned direct call as an employee payment", () => {
    expect(paymentActions({ signer_id: "sponsor.testnet", receiver_id: treasury, actions: [call] }, actor, treasury)).toEqual([]);
  });
});
