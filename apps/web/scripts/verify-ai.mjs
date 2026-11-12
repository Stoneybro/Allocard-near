// Opt-in deployment check. Never prints credentials or provider response bodies.
if (process.env.ALLOCARD_AI_SMOKE === "1") {
  const { aiChat, getApiKey, getBaseUrl, getTextModel } = await import("../lib/ai.ts");
  if (!getApiKey()) throw new Error("Production AI credential is missing or empty");
  const started = Date.now();
  const result = await aiChat({ timeoutMs: 35_000, messages: [
    { role: "system", content: `You compile spending policies. Amounts are human-readable USDC strings; the field names retain a legacy Near suffix. Return ONLY a flat JSON object matching this exact schema:
{"confidence": number, "lifetimeLimitNear": string, "period": "none" | "hourly" | "daily" | "weekly" | "monthly", "periodLimitNear": string | null, "perTransactionCapNear": string | null, "allowedTargets": string[]}
The lifetime total, allowance per period, and maximum per payment are separate limits. Copy the explicit amounts from the request. Recipient restrictions are exact NEAR account IDs. Do not wrap the result in another object.` },
    { role: "user", content: "Authorize 50 USDC total, 10 USDC per week, 5 USDC per payment, only to vendor.testnet." },
  ] });
  if (Number(result.lifetimeLimitNear) !== 50 || Number(result.periodLimitNear) !== 10 || Number(result.perTransactionCapNear) !== 5 || result.period !== "weekly" || !Array.isArray(result.allowedTargets) || result.allowedTargets.join(",") !== "vendor.testnet") {
    console.info("[AI smoke] Synthetic policy result did not match", { fields: Object.keys(result), period: result.period, total: result.lifetimeLimitNear, recurring: result.periodLimitNear, perPayment: result.perTransactionCapNear });
    throw new Error("Production AI did not return the expected policy settings");
  }
  console.info("[AI smoke] Passed", { provider: new URL(getBaseUrl()).hostname, model: getTextModel(), durationMs: Date.now() - started });
}
