import { generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { utils } from "near-api-js";
import { describe, it, expect } from "vitest";
import { loginDigest, verifyLoginProof } from "@/lib/near-proof";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const encodedKey = `ed25519:${utils.serialize.base_encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32))}`;
const challenge = { accountId: "owner.testnet", recipient: "https://allocard.example", message: "Sign in", nonce: randomBytes(32).toString("base64") };
const proof = { accountId: challenge.accountId, publicKey: encodedKey, signature: sign(null, loginDigest(challenge), privateKey).toString("base64") };
describe("wallet ownership proof", () => {
  it("accepts a genuine Ed25519 NEP-413 signature", () => expect(() => verifyLoginProof(challenge, proof)).not.toThrow());
  it.each([{ ...challenge, nonce: randomBytes(32).toString("base64") }, { ...challenge, recipient: "https://attacker.example" }, { ...challenge, message: "Authorize a payment" }, { ...challenge, accountId: "employee.testnet" }])("rejects a changed challenge", changed => expect(() => verifyLoginProof(changed, proof)).toThrow());
  it("binds an explicit MyNearWallet callback URL", () => {
    const withCallback = { ...challenge, callbackUrl: challenge.recipient + "/" };
    const signed = { ...proof, signature: sign(null, loginDigest(withCallback), privateKey).toString("base64") };
    expect(() => verifyLoginProof(withCallback, signed)).not.toThrow();
    expect(() => verifyLoginProof(challenge, signed)).toThrow();
  });
  it("rejects malformed keys and signatures", () => {
    expect(() => verifyLoginProof(challenge, { ...proof, signature: "AA==" })).toThrow();
    expect(() => verifyLoginProof(challenge, { ...proof, publicKey: "secp256k1:invalid" })).toThrow();
  });
});
