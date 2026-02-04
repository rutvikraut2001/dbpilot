import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Set the root directory for Turbopack to avoid the lockfile warning
  turbopack: {
    root: path.resolve(__dirname),
  },
  webpack: (config, { isServer }) => {
    // Monaco Editor webpack configuration
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
