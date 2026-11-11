import { AsyncLocalStorage } from "node:async_hooks";

const reads = new AsyncLocalStorage<{ signal: AbortSignal; id: number }>();
let sequence = 0;
export const nearReadSignal = () => reads.getStore()?.signal;
export const nearReadScope = () => reads.getStore()?.id;
/** Bound an entire dashboard read, rather than giving each dependent RPC a fresh timeout. */
export function withNearReadDeadline<T>(signal: AbortSignal, operation: () => Promise<T>) {
  return reads.run({ signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), id: ++sequence }, operation);
}
