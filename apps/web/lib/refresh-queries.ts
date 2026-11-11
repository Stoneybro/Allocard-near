import type { QueryClient } from "@tanstack/react-query";

/** Coalesce completion refreshes and cancel only reads that precede the confirmed write. */
type Refresh = { promise: Promise<void>; fetching: boolean; again: boolean };
const pending = new WeakMap<QueryClient, Map<string, Refresh>>();
export function refreshSpendingQueries(client: QueryClient, key: readonly unknown[], includeDashboard = true): Promise<void> {
  const families = new Set(["treasury", "activity", "research", "delegation-research", ...(includeDashboard ? ["dashboard"] : [])]);
  const filters = { queryKey: key, predicate: (query: { queryKey: readonly unknown[] }) => families.has(String(query.queryKey[key.length])) };
  let requests = pending.get(client);
  if (!requests) { requests = new Map(); pending.set(client, requests); }
  const id = JSON.stringify([key, includeDashboard]);
  const existing = requests.get(id);
  if (existing) {
    // A second settlement during a read needs another snapshot. Calls made
    // before the read starts can share that same snapshot.
    if (existing.fetching) existing.again = true;
    return existing.promise;
  }
  const refresh: Refresh = { promise: Promise.resolve(), fetching: false, again: false };
  const operation = (async () => {
    do {
      refresh.again = false;
      // A read begun before settlement must not overwrite the confirmed result.
      await client.cancelQueries(filters);
      refresh.fetching = true;
      await client.invalidateQueries(filters, { cancelRefetch: false });
      refresh.fetching = false;
    } while (refresh.again);
  })().finally(() => { requests!.delete(id); });
  refresh.promise = operation;
  requests.set(id, refresh);
  return operation;
}
