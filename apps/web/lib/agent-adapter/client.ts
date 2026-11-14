"use client";

export async function researchRequest<T>(url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(95000),
    });
  } catch {
    throw new Error("The research service could not be reached. Retry to check the same request.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Research service unavailable. Please try again.");
  if (data === null) throw new Error("The research service returned an empty response. Please try again.");
  return data as T;
}
