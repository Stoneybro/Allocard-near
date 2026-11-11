import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { refreshSpendingQueries } from "@/lib/refresh-queries";

it("reads again when another transaction settles during an in-flight refresh", async () => {
  const client = new QueryClient();
  let finish!: () => void;
  const invalidate = vi.spyOn(client, "invalidateQueries")
    .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
    .mockResolvedValue();
  const first = refreshSpendingQueries(client, ["account"]);
  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  const second = refreshSpendingQueries(client, ["account"]);
  finish();
  await Promise.all([first, second]);
  expect(invalidate).toHaveBeenCalledTimes(2);
  client.clear();
});
