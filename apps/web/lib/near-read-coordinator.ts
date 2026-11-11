/** Server-only coordination. Cached snapshots are opt-in and advisory, never nonce/ownership proofs. */
const inFlight = new Map<string, Promise<any>>();
const snapshots = new Map<string, { until: number; value: any }>();
const cooldowns = new Map<string, number>();
let generation = 0;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function invalidateNearReadCache() {
  generation++;
  snapshots.clear();
  inFlight.clear();
}
export async function coordinatedNearRead(url: string, params: Record<string, unknown>, run: () => Promise<any>, cacheMs = 0, dedupe = false, scope?: number) {
  // In particular, do not reuse an access-key nonce after a transaction.
  if (params.request_type !== "call_function" || (cacheMs <= 0 && !dedupe)) return run();
  const key = JSON.stringify([url, params]);
  const flightKey = scope === undefined ? key : `${key}:${scope}`;
  const cached = snapshots.get(key);
  if (cacheMs > 0 && cached && cached.until > Date.now()) return cached.value;
  if (cached && cached.until <= Date.now()) snapshots.delete(key);
  const version = generation;
  let pending = inFlight.get(flightKey);
  if (!pending) {
    pending = run();
    inFlight.set(flightKey, pending);
  }
  try {
    const result = await pending;
    if (cacheMs > 0 && version === generation) {
      if (snapshots.size >= 128) snapshots.delete(snapshots.keys().next().value!);
      snapshots.set(key, { until: Date.now() + Math.min(cacheMs, 2000), value: result });
    }
    return result;
  } finally {
    if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey);
  }
}
export async function waitForRpcCooldown(url: string): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (true) {
    const remaining = (cooldowns.get(url) ?? 0) - Date.now();
    if (remaining <= 0) { cooldowns.delete(url); return true; }
    if (Date.now() + remaining > deadline) return false;
    await sleep(remaining);
  }
}
export function rpcCooldownMs(url: string): number { return Math.max(0, (cooldowns.get(url) ?? 0) - Date.now()); }
export function noteRpcRateLimit(url: string, response: Response) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : 1000;
  const delay = Number.isFinite(seconds) ? Math.max(1000, seconds) : 1000;
  cooldowns.set(url, Math.max(cooldowns.get(url) ?? 0, Date.now() + delay));
}
export async function backoffNearRead(url: string, response: Response): Promise<boolean> {
  if (response.status !== 429) { await sleep(250); return true; }
  noteRpcRateLimit(url, response);
  return waitForRpcCooldown(url);
}
