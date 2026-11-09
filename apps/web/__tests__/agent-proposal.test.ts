import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { proposalDigest } from "@/lib/agent-adapter/store";
import { DEMO_LIMITS,taskInput } from "@/lib/agent-adapter/shared";
describe("research proposal and limits",()=>{
 const input={companyId:"company",employeeId:"alice",delegationId:"child-A",prompt:"Find software for my team",expiresAt:"2026-11-09T12:00:00Z"};
 it("binds employee, company, child permission, brief and expiry",()=>{const original=proposalDigest(input);for(const key of Object.keys(input) as (keyof typeof input)[])expect(proposalDigest({...input,[key]:"changed"})).not.toBe(original);expect(proposalDigest({...input})).toBe(original);});
 it("uses reduced admission limits without pretending they are provider capacity",()=>{expect(DEMO_LIMITS.concurrentGlobal).toBe(12);expect(DEMO_LIMITS.concurrentEmployee).toBe(2);expect(DEMO_LIMITS.dailyMicros).toBe(25_000_000);expect(DEMO_LIMITS.queue).toBe(100);});
 it("does not accept browser-supplied payment or worker settings",()=>{expect(taskInput.safeParse({companyId:"11111111-1111-4111-8111-111111111111",delegationId:"22222222-2222-4222-8222-222222222222",requestId:"33333333-3333-4333-8333-333333333333",prompt:input.prompt,payment:true}).success).toBe(false);});
});
