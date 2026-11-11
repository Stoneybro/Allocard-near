import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack is the default bundler in Next.js 16+.
  // An empty `turbopack` object silences the "no turbopack config" warning.
  turbopack: {},
  // Use the compiler API available in the installed TypeScript 5 release.
  experimental: { useTypeScriptCli: false },
  transpilePackages: ["@allocard/delegation-sdk"],
  outputFileTracingRoot: process.cwd().endsWith("apps/web") ? process.cwd() + "/../.." : process.cwd(),
  outputFileTracingIncludes: { "/*": ["../../packages/contracts/res/allocard_treasury.wasm", "../../packages/contracts/res/allocard_factory.wasm", "../../packages/contracts/res/allocard_shared.wasm", "../../packages/contracts/res/allocard_shared_v3.wasm", "../../packages/contracts/res/allocard_treasury_v2.wasm"] },
};

export default nextConfig;
