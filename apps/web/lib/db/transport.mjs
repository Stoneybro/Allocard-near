import https from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
const databaseReads = new AsyncLocalStorage();
export const databaseReadSignal = () => databaseReads.getStore();
/** @template T @param {AbortSignal} signal @param {() => Promise<T>} operation @returns {Promise<T>} */
export function withDatabaseDeadline(signal, operation) {
  return databaseReads.run(AbortSignal.any([signal, AbortSignal.timeout(20_000)]), operation);
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Neon HTTP transport with IPv4 routing and an end-to-end deadline.
 * @type {typeof fetch}
 */
export const neonFetch = async (input, options) => {
  const url = input instanceof Request ? input.url : input;
  const inherited = databaseReadSignal();
  const signal = options?.signal && inherited ? AbortSignal.any([options.signal, inherited]) : inherited || options?.signal;
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(options?.headers).entries());
    const req = https.request(url, {
      method: options?.method ?? "POST", headers, family: 4,
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    /** @param {Error} error */
    const fail = (error) => { cleanup(); reject(error); };
    const abort = () => req.destroy(new Error("Database request aborted"));
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error("Database request timed out"), { code: "ETIMEDOUT" }));
    }, REQUEST_TIMEOUT_MS);
    req.on("error", fail);
    req.on("response", res => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", fail);
      res.on("aborted", () => fail(new Error("Database connection terminated during response")));
      res.on("end", () => {
        cleanup();
        try {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 200, headers: responseHeaders,
          }));
        } catch (error) { reject(error); }
      });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    if (options?.body) req.write(options.body);
    req.end();
  });
};
