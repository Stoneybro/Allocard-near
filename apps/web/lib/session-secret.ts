import { randomBytes } from "node:crypto";
// A random process-local development secret fails closed across process restarts.
const devSecret = randomBytes(32);
export function sessionSecret(): Uint8Array {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV === "production") throw new Error("Set SESSION_SECRET to at least 32 random characters");
  return devSecret;
}
