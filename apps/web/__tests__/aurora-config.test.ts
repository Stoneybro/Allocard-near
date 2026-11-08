import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GET } from "../app/api/aurora/config/route";

describe("GET /api/aurora/config", () => {
  const originalApiKey = process.env.AURORA_INTENTS_API_KEY;
  const originalEnv = process.env.AURORA_INTENTS_ENVIRONMENT;

  beforeEach(() => {
    delete process.env.AURORA_INTENTS_API_KEY;
    delete process.env.NEXT_PUBLIC_AURORA_INTENTS_API_KEY;
    delete process.env.AURORA_INTENTS_ENVIRONMENT;
    delete process.env.NEXT_PUBLIC_AURORA_INTENTS_ENVIRONMENT;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.AURORA_INTENTS_API_KEY = originalApiKey;
    }
    if (originalEnv !== undefined) {
      process.env.AURORA_INTENTS_ENVIRONMENT = originalEnv;
    }
  });

  it("returns empty string and production default when no env is set", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.apiKey).toBe("");
    expect(data.environment).toBe("production");
  });

  it("returns AURORA_INTENTS_API_KEY from server environment", async () => {
    process.env.AURORA_INTENTS_API_KEY = "sk-test-key-12345";
    process.env.AURORA_INTENTS_ENVIRONMENT = "staging";

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.apiKey).toBe("sk-test-key-12345");
    expect(data.environment).toBe("staging");
  });
});

