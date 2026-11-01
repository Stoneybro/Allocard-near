import { describe, it, expect } from "vitest";
import {
  computeExecuteHash,
  computeOwnerWithdrawHash,
  generateRequestId,
  parseRequestId,
} from "../src/canonical.js";
import { ExecuteRequest, OwnerWithdrawRequest } from "../src/types.js";

describe("SDK Canonical Serialization & Hashing", () => {
  it("matches Rust canonical SHA-256 test vector byte-for-byte", () => {
    const networkDomain = "near:mainnet";
    const contractId = "treasury.allocard.near";
    const actor = "employee.near";
    const receiver = "vendor.near";

    const request: ExecuteRequest = {
      api_version: 1,
      request_id: "a000000000000000000000000000000000000000000000000000000000000001",
      permission_id: "42",
      action: {
        type: "Transfer",
        asset: { type: "NativeNear" },
        receiver,
        amount: "1000000000000000000000000", // 1 NEAR
      },
      deadline_ms: "1700000000000",
    };

    const hash = computeExecuteHash(networkDomain, contractId, actor, request);
    // Exact hash produced by Rust allocard-treasury crate canonical test vector:
    expect(hash).toBe("1349d7047d8f44b5f5ea2ec182812d3aa0f40363d5add7e9dae19ac7e0b1ecd6");
  });

  it("computes deterministic owner withdraw hash", () => {
    const networkDomain = "near:mainnet";
    const contractId = "treasury.allocard.near";
    const actor = "owner.near";

    const request: OwnerWithdrawRequest = {
      api_version: 1,
      request_id: "a000000000000000000000000000000000000000000000000000000000000001",
      authority_epoch: "1",
      action: {
        type: "Transfer",
        asset: { type: "NativeNear" },
        receiver: "cold-wallet.near",
        amount: "5000000000000000000000000",
      },
      deadline_ms: "1700000000000",
    };

    const hash1 = computeOwnerWithdrawHash(networkDomain, contractId, actor, request);
    const hash2 = computeOwnerWithdrawHash(networkDomain, contractId, actor, request);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validates request id format", () => {
    const valid = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const parsed = parseRequestId(valid);
    expect(parsed.length).toBe(32);

    expect(() => parseRequestId("short")).toThrow("ALLOCARD_INVALID_INPUT");
    expect(() =>
      parseRequestId("0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef")
    ).toThrow("ALLOCARD_INVALID_INPUT");
  });

  it("generates valid 64-char lowercase hex request IDs", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    const id2 = generateRequestId();
    expect(id).not.toBe(id2);
  });
});
