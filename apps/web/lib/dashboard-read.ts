/** Independent HTTP reads avoid waiting behind a mutation in Next's action queue. */
export async function dashboardRead<T>(view: "profile" | "employee" | "employer", wallet: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/dashboard?${new URLSearchParams({ view, wallet })}`, { credentials: "same-origin", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Your dashboard could not be loaded. Please retry.");
  return data;
}
