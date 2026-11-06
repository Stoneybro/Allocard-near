import { expect, it } from "vitest";
import { KeyPair } from "near-api-js";
// @ts-expect-error Operator tooling intentionally stays outside browser declarations.
import { factoryDeploymentActions } from "../scripts/deploy-factory.mjs";
it("deploys and initializes the factory before removing every deployment key", () => {
  const publicKey=KeyPair.fromRandom("ed25519").getPublicKey().toString();
  const batch=factoryDeploymentActions(new Uint8Array([1,2]), { treasury_code_hash: "hash", network_domain: "near:testnet", account_funding: "100" }, [{ public_key: publicKey }]);
  expect(batch).toHaveLength(3);
  expect(batch[0].deployContract.code).toEqual(new Uint8Array([1,2]));
  expect(batch[1].functionCall.methodName).toBe("new");
  expect(JSON.parse(new TextDecoder().decode(batch[1].functionCall.args)).treasury_code_hash).toBe("hash");
  expect(batch[2].deleteKey.publicKey.toString()).toBe(publicKey);
  expect(batch.some((action: { addKey?: unknown }) => action.addKey)).toBe(false);
});
