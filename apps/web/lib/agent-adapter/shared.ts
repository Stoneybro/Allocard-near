import { z } from "zod";
export const ADAPTER_NAME = "Allocard Purchasing Research Adapter";
export const WORKER_HANDLE = "purchasing-research-agent-v2";
export const DEMO_LIMITS = { dailyEmployee: 25, dailyGlobal: 500, concurrentEmployee: 2, concurrentGlobal: 12, queue: 100, dailyMicros: 25_000_000, reserveMicros: 250_000 } as const;
export const taskInput = z.object({ companyId: z.string().uuid(), delegationId: z.string().uuid(), prompt: z.string().trim().min(20).max(3000), requestId: z.string().uuid() }).strict();
export const confirmInput = z.object({ id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const terminal = (state: string) => ["delivered", "failed", "cancelled", "expired"].includes(state);
export type ResearchTask = { id: string; prompt: string; digest: string; state: string; message: string | null; result: string | null; createdAt: string; expiresAt: string; delegationId: string; companyId: string; employeeId: string };
export type Candidate = { id: string; name: string; description: string; handle: string | null; price: string | null; url: string };
