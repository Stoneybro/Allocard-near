// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ address: "alice.testnet" }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ status: "authenticated", providerUserId: "did:privy:alice", address: mocks.address }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
vi.mock("@/app/actions/identity", () => ({ getWalletProfile: vi.fn(), getWorkspaceOptions: vi.fn() }));
import { useSettlementRefresh } from "@/hooks/use-account-queries";
let root: Root; let client: QueryClient; let refresh: () => void;
function Probe() { refresh = useSettlementRefresh(); return null; }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>)); }
beforeEach(() => { vi.useFakeTimers(); mocks.address = "alice.testnet"; Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); root = createRoot(document.createElement("div")); client = new QueryClient(); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.useRealTimers(); });
it("refreshes affected queries once after settlement without a polling burst", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  await render(); await act(async () => { refresh(); await Promise.resolve(); }); expect(invalidate).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenLastCalledWith({ queryKey: ["allocard", "testnet", "did:privy:alice", "alice.testnet"], predicate: expect.any(Function) }, { cancelRefetch: false });
});
it("cancels scheduled reads when the account changes", async () => {
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  await render(); await act(async () => { refresh(); await Promise.resolve(); }); mocks.address = "bob.testnet"; await render();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(invalidate).toHaveBeenCalledTimes(1);
});
