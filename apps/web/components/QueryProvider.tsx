"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, retry: false, refetchOnWindowFocus: true },
      // Signing, payments, invitations and other writes must never auto-retry.
      mutations: { retry: false },
    },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
