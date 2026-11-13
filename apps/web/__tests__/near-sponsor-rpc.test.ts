import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cooldown: vi.fn(), backoff: vi.fn(), limited: vi.fn() }));
vi.mock("@/lib/near-read-coordinator", () => ({ waitForRpcCooldown: mocks.cooldown, backoffNearRead: mocks.backoff, noteRpcRateLimit: mocks.limited }));
import { relayRpc } from "@/lib/near-sponsor-rpc";
import { NearRpcError } from "@/lib/near-rpc-error";
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset();
  mocks.cooldown.mockResolvedValue(true); mocks.backoff.mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("retries a transient network check and gas-price read once", async () => {
  fetchMock.mockResolvedValueOnce(new Response("provider unavailable", { status: 503 })).mockResolvedValueOnce(Response.json({ result: { chain_id: "testnet" } }));
  expect(await relayRpc("status", {})).toEqual({ chain_id: "testnet" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockReset().mockRejectedValueOnce(new TypeError("connection reset")).mockResolvedValueOnce(Response.json({ result: { gas_price: "100" } }));
  expect(await relayRpc("gas_price", [null])).toEqual({ gas_price: "100" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("respects a provider cooldown without retrying a long rate limit", async () => {
  mocks.backoff.mockResolvedValue(false);
  fetchMock.mockResolvedValueOnce(new Response("private provider detail", { status: 429, headers: { "retry-after": "60" } }));
  await expect(relayRpc("status", {})).rejects.toThrow("rate limiting");
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(mocks.limited).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private provider detail");
});
it("does not retry an RPC credential failure", async () => {
  fetchMock.mockResolvedValueOnce(new Response("private credential diagnostic", { status: 403 }));
  await expect(relayRpc("status", {})).rejects.toThrow("rejected access");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("never automatically repeats a broadcast after a network timeout", async () => {
  fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
  await expect(relayRpc("send_tx", { signed_tx_base64: "private-signed-data" }, "saved-hash")).rejects.toThrow("Sponsored transaction saved-hash is not yet confirmed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-signed-data");
});
it("preserves authoritative rejection so only the rejected job can be released", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: { cause: { name: "INVALID_TRANSACTION" }, data: { TxExecutionError: { InvalidTxError: { NotEnoughBalance: { balance: "0" } } } } } }));
  await expect(relayRpc("send_tx", {}, "rejected-hash")).rejects.toBeInstanceOf(NearRpcError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("recovers a known transaction by read only after a transient response", async () => {
  fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 502 })).mockResolvedValueOnce(Response.json({ result: { transaction: { hash: "original" } } }));
  await relayRpc("tx", { tx_hash: "original", sender_account_id: "sponsor.testnet", wait_until: "FINAL" }, "original");
  expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
    expect.objectContaining({ method: "tx", params: expect.objectContaining({ tx_hash: "original" }) }),
    expect.objectContaining({ method: "tx", params: expect.objectContaining({ tx_hash: "original" }) }),
  ]);
});
it("preserves UNKNOWN_TRANSACTION for a non-waiting status lookup without treating it as rejection", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: { cause: { name: "UNKNOWN_TRANSACTION" }, message: "Unknown" } }));
  await expect(relayRpc("tx", { tx_hash: "original", wait_until: "NONE" }, "original")).rejects.toMatchObject({ rpcCause: "UNKNOWN_TRANSACTION" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("retries HTTP 408 on reads without repeating a timed-out broadcast", async () => {
  fetchMock.mockResolvedValueOnce(new Response("timeout", { status: 408 })).mockResolvedValueOnce(Response.json({ result: { chain_id: "testnet" } }));
  expect(await relayRpc("status", {})).toEqual({ chain_id: "testnet" });
  fetchMock.mockReset().mockResolvedValue(new Response("timeout", { status: 408 }));
  await expect(relayRpc("send_tx", {}, "original")).rejects.toThrow("not yet confirmed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
