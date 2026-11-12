/**
 * lib/ai.ts — NEAR AI Cloud integration module (with DashScope fallback)
 *
 * Primary Endpoint: https://cloud-api.near.ai/v1 (NEAR AI Cloud)
 * Auth: Authorization: Bearer $NEAR_AI_API_KEY
 *
 * Model:
 *   - Text / reasoning / policy parsing: deepseek-ai/DeepSeek-V4.1-Flash-1017 (or Qwen/Qwen3.8-27B)
 */

const DEFAULT_NEAR_AI_BASE_URL = "https://cloud-api.near.ai/v1";
const DEFAULT_DASHSCOPE_BASE_URL = "https://ws-hjdcclpedbb2egen.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";

const DEFAULT_NEAR_AI_TEXT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const DEFAULT_DASHSCOPE_TEXT_MODEL = "qwen3.8-max";

function nearKey() { return process.env.NEAR_AI_API_KEY?.trim() || process.env.NEARAI_API_KEY?.trim() || null; }
export function getBaseUrl(): string {
  const base = nearKey() || !process.env.DASHSCOPE_API_KEY?.trim()
    ? process.env.NEAR_AI_BASE_URL || process.env.NEARAI_BASE_URL || DEFAULT_NEAR_AI_BASE_URL
    : process.env.DASHSCOPE_BASE_URL || DEFAULT_DASHSCOPE_BASE_URL;
  return base.replace(/\/+$/, "");
}
export function getApiKey(): string | null {
  return nearKey() || process.env.DASHSCOPE_API_KEY?.trim() || null;
}
export function getTextModel(): string {
  return nearKey() || !process.env.DASHSCOPE_API_KEY?.trim()
    ? process.env.NEAR_AI_MODEL || process.env.NEARAI_MODEL || DEFAULT_NEAR_AI_TEXT_MODEL
    : process.env.DASHSCOPE_MODEL || DEFAULT_DASHSCOPE_TEXT_MODEL;
}

export const TEXT_MODEL = getTextModel();

export async function aiChat<T>(params: {
  model?: string;
  messages: Array<{ role: string; content: unknown }>;
  responseSchema?: Record<string, unknown>;
  disableJsonSchema?: boolean;
  timeoutMs?: number;
}): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("NEAR_AI_API_KEY or DASHSCOPE_API_KEY is not configured");

  const model = params.model || getTextModel();
  const body: Record<string, unknown> = {
    model,
    messages: params.messages,
    temperature: 0.2,
    max_tokens: 1500,
    response_format: { type: "json_object" },
  };

  const res = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.timeoutMs ? AbortSignal.timeout(params.timeoutMs) : undefined,
  });

  if (!res.ok) {
    await res.text();
    console.error("[aiChat] Provider request failed", { status: res.status, model });
    throw new Error(`AI service returned HTTP ${res.status}. Please retry or use manual setup.`);
  }

  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  let content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned an empty response");

  // Clean markdown backticks if the model returned them instead of raw JSON
  content = content.replace(/^```(json)?\s*/i, "").replace(/```$/, "").trim();

  // If there's surrounding text, locate the enclosing JSON object
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    content = content.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(content) as T;
}

export const qwenChat = aiChat;
