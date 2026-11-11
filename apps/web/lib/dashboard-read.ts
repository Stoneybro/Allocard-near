/** Independent HTTP reads avoid the server action queue. Cooldowns are per identity/view. */
export class DashboardReadError extends Error {
  constructor(message: string, public readonly retryAt = 0) { super(message); this.name = "DashboardReadError"; }
}
const cooldowns = new Map<string, DashboardReadError>();
export async function dashboardRead<T>(view: "profile" | "employee" | "employer", wallet: string, signal?: AbortSignal): Promise<T> {
  const url = `/api/dashboard?${new URLSearchParams({ view, wallet })}`;
  const cooldown = cooldowns.get(url);
  if (cooldown && cooldown.retryAt > Date.now()) throw cooldown;
  cooldowns.delete(url);
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) {
      const seconds = Number(response.headers.get("retry-after") || "0");
      const error = new DashboardReadError(data.error || "Live data is temporarily unavailable. Please retry.", Date.now() + Math.max(0, seconds) * 1000);
      if (seconds > 0) { if (cooldowns.size >= 64) cooldowns.clear(); cooldowns.set(url, error); }
      throw error;
    }
    return data;
  } catch (caught) {
    if (signal?.aborted) throw caught; // TanStack cancellation is not an application error.
    if (caught instanceof DashboardReadError) throw caught;
    throw new DashboardReadError("Live data is taking too long to load. Your last confirmed values are unchanged. Please retry.");
  }
}
