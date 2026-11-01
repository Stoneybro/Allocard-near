import { it, expect } from "vitest";
// @ts-expect-error Deployment-only JavaScript tooling intentionally has no browser declarations.
import { deploymentActions } from "../scripts/deploy.mjs";
it("batches deployment and initialization in that order", () => {
  const batch = deploymentActions(new Uint8Array([1, 2]), { owner: "owner.near", network_domain: "near:testnet" });
  expect(batch).toHaveLength(2);
  expect(batch[0].deployContract.code).toEqual(new Uint8Array([1, 2]));
  expect(batch[1].functionCall.methodName).toBe("new");
  expect(JSON.parse(new TextDecoder().decode(batch[1].functionCall.args)).config.owner).toBe("owner.near");
});
