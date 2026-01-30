import { NextResponse } from "next/server";

/**
 * Health check endpoint for monitoring and load balancers.
 * Returns basic health status and metadata.
 */
export async function GET() {
  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.1.0",
    environment: process.env.NODE_ENV || "development",
  });
}
