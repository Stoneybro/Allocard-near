import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ batch: vi.fn(), execute: vi.fn(), condition: vi.fn(), returned: vi.fn(), lookup: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  batch: mocks.batch, execute: mocks.execute,
  select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }),
  update: () => ({ set: () => ({ where: (condition: unknown) => { mocks.condition(condition); return { returning: mocks.returned }; } }) }),
  insert: () => ({ values: mocks.insert }),
} }));
import { issueSession, readSession, revokeSession, hashSessionToken } from "@/lib/session-store";
const identity = { providerUserId: "did:privy:alice", walletAddress: "a".repeat(64), email: "a@example.com" };
beforeEach(() => { vi.clearAllMocks(); mocks.batch.mockResolvedValue([{}, { rows: [{ token_hash: "hash" }] }]); mocks.execute.mockImplementation(query => query); mocks.insert.mockReturnValue({ onConflictDoNothing: () => ({}) }); mocks.lookup.mockResolvedValue([]); mocks.returned.mockResolvedValue([]); });
describe("revocable server sessions", () => {
  it("issues opaque random tokens and stores only a digest", async () => {
    const token = await issueSession(identity, "privy-session");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const statements = mocks.execute.mock.calls.map(call => new PgDialect().sqlToQuery(call[0]));
    expect(statements[0].sql).toContain("pg_advisory_xact_lock");
    expect(statements[1].sql).toContain("not exists");
    expect(statements[1].params).toContain(hashSessionToken(token));
    expect(statements[1].params).not.toContain(token);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
  it("rejects exchanges when logout has revoked the provider session", async () => {
    mocks.batch.mockResolvedValue([{}, { rows: [] }]);
    await expect(issueSession(identity, "revoked-session")).rejects.toThrow("logged out");
  });
  it("requires non-revoked sessions inside both idle and absolute expiry", async () => {
    expect(await readSession("x".repeat(43))).toBeNull();
    const condition = new PgDialect().sqlToQuery(mocks.condition.mock.calls[0][0]);
    expect(condition.sql).toContain('"revoked_at" is null');
    expect(condition.sql).toContain('"expires_at" > now()');
    expect(condition.sql).toContain("interval '30 minutes'");
    expect(condition.sql).toContain("not exists");
  });
  it("does not query the database for an old JWT or malformed cookie", async () => {
    expect(await readSession("old.jwt.cookie")).toBeNull(); expect(mocks.condition).not.toHaveBeenCalled();
  });
  it("revokes all rotations sharing one provider session under its lock", async () => {
    mocks.lookup.mockResolvedValue([{ providerSessionHash: "hash" }]);
    await revokeSession("x".repeat(43));
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith({ providerSessionHash: "hash" });
  });
});
