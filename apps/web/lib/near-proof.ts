import { createHash, createPublicKey, verify } from "node:crypto";
import { utils } from "near-api-js";

export type LoginChallenge = { accountId: string; nonce: string; recipient: string; message: string; callbackUrl?: string };
export type WalletProof = { accountId: string; publicKey: string; signature: string };

/** NEP-413: tag + message + 32-byte nonce + recipient + absent callback URL. */
export function loginDigest(challenge: LoginChallenge): Buffer {
  const text = (value: string) => {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const nonce = Buffer.from(challenge.nonce, "base64");
  if (nonce.length !== 32) throw new Error("Invalid sign-in nonce");
  return createHash("sha256").update(Buffer.concat([tag, text(challenge.message), nonce, text(challenge.recipient), challenge.callbackUrl ? Buffer.concat([Buffer.from([1]), text(challenge.callbackUrl)]) : Buffer.from([0])])).digest();
}

export function verifyLoginProof(challenge: LoginChallenge, proof: WalletProof): void {
  if (proof.accountId !== challenge.accountId || !proof.publicKey.startsWith("ed25519:")) throw new Error("Wrong signing account or key type");
  const key = utils.serialize.base_decode(proof.publicKey.slice(8));
  const signature = Buffer.from(proof.signature, "base64");
  if (key.length !== 32 || signature.length !== 64) throw new Error("Invalid signature encoding");
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]), format: "der", type: "spki" });
  if (!verify(null, loginDigest(challenge), publicKey, signature)) throw new Error("Invalid wallet signature");
}
