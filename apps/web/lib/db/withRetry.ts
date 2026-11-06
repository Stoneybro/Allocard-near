/**
 * Retry a database operation on transient Neon connection failures.
 * The Neon serverless HTTP driver can intermittently lose connections
 * (DNS, cold starts, network jitter). This wraps any async DB op with
 * up to 3 retries and exponential backoff.
 */

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 400;

/** Transient error patterns that indicate a retriable Neon connection failure. */
const TRANSIENT_PATTERNS = [
  "fetch failed", "error connecting to database", "connection terminated",
  "connection closed", "connection reset", "connection refused", "timeout",
  "timed out", "econnrefused", "econnreset", "socket hang up", "network",
  "unreachable", "dns", "etimedout", "eai_again", "couldn't connect to compute",
];

function isTransientError(err: unknown, depth = 0): boolean {
  if (depth > 5 || !err || typeof err !== "object") return false;
  const item = err as { code?: string; message?: string; status?: number; cause?: unknown };
  // SQLSTATE errors are authoritative; SQL text and parameters are not evidence
  // of a connection failure. In particular, never retry missing schema/auth errors.
  if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "EPIPE"].includes(item.code ?? "")) return true;
  if (item.code && /^[0-9A-Z]{5}$/.test(item.code)) {
    return item.code.startsWith("08") || ["53300", "57P01", "57P02", "57P03"].includes(item.code);
  }
  if ([502, 503, 504].includes(item.status ?? 0)) return true;
  if (err instanceof AggregateError && err.errors.some(e => isTransientError(e, depth + 1))) return true;
  if (item.cause) return isTransientError(item.cause, depth + 1);
  const message = item.message?.toLowerCase() ?? "";
  if (message.startsWith("failed query:")) return false;
  return TRANSIENT_PATTERNS.some(pattern => message.includes(pattern)) ||
    /\b(502|503|504)\b/.test(message);
}

export async function withRetry<T>(fn: () => Promise<T>, label?: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt === MAX_RETRIES || !isTransientError(err)) {
        throw err;
      }

      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.warn(
        `[DB retry] ${label ?? "query"} attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${delay}ms:`,
        "Transient database connection failure",
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
