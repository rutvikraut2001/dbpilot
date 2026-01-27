import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Set the root directory for Turbopack to avoid the lockfile warning
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
