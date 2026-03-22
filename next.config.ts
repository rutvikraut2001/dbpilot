import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

  // Keep native Node.js packages out of the Turbopack/webpack bundle so they
  // are resolved at runtime from node_modules instead of being inlined.
  // ssh2 uses native crypto (non-ESM placeable) and must stay external.
  serverExternalPackages: ["ssh2"],

  // Set the root directory for Turbopack to avoid the lockfile warning
  turbopack: {
    root: path.resolve(__dirname),
  },

  // Force-include packages that use conditional exports or dynamic requires
  // that the Next.js file tracer cannot follow statically.
  outputFileTracingIncludes: {
    "*": [
      // @clickhouse/client uses conditional package exports — the static tracer
      // misses it, so we force-include the entire package tree.
      "node_modules/@clickhouse/**",
    ],
  },

  // Exclude packages from the standalone bundle that are NOT needed at runtime.
  // This is the primary lever for reducing Docker image size.
  outputFileTracingExcludes: {
    "*": [
      // ─── SWC / Next.js compiler binaries ─────────────────────────────────
      // Used only during `next build`, never at runtime.
      "node_modules/@next/swc-linux-x64-gnu/**",
      "node_modules/@next/swc-linux-x64-musl/**",
      "node_modules/@next/swc-linux-arm64-gnu/**",
      "node_modules/@next/swc-linux-arm64-musl/**",
      "node_modules/@next/swc-darwin-x64/**",
      "node_modules/@next/swc-darwin-arm64/**",
      "node_modules/@next/swc-win32-x64-msvc/**",
      "node_modules/@next/swc-win32-arm64-msvc/**",
      "node_modules/@swc/core-linux-x64-gnu/**",
      "node_modules/@swc/core-linux-x64-musl/**",
      "node_modules/@swc/core-darwin-x64/**",
      "node_modules/@swc/core-darwin-arm64/**",

      // ─── Sharp / image-processing native libraries ────────────────────────
      // Next.js optionally uses sharp for <Image> optimisation. This app does
      // not use <Image>, so the 33 MB of libvips native binaries are dead weight.
      "node_modules/sharp/**",
      "node_modules/@img/**",

      // ─── TypeScript compiler ──────────────────────────────────────────────
      // devDependency — only needed during `next build`, not at runtime (20 MB).
      "node_modules/typescript/**",

      // ─── Client-side only packages ────────────────────────────────────────
      // Loaded by webpack as browser bundles; the server never requires them.
      "node_modules/monaco-editor/**",
      "node_modules/@monaco-editor/react/**",
      "node_modules/@xyflow/react/**",
      "node_modules/@xyflow/system/**",
      "node_modules/html-to-image/**",
    ],
  },
};

export default nextConfig;
