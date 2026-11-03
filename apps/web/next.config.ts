import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16+.
  // An empty `turbopack` object silences the "no turbopack config" warning.
  turbopack: {},
  transpilePackages: ["@allocard/delegation-sdk"],
  outputFileTracingRoot: process.cwd().endsWith("apps/web") ? process.cwd() + "/../.." : process.cwd(),
  outputFileTracingIncludes: { "/*": ["../../packages/contracts/res/allocard_treasury.wasm"] },
};

export default nextConfig;
