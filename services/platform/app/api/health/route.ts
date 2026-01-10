import { existsSync } from 'fs';
import { NextResponse } from 'next/server';

/**
 * Force dynamic rendering - disable Next.js Full Route Cache
 * Critical for health endpoint to always return fresh status
 */
export const dynamic = 'force-dynamic';

/**
 * Shutdown marker file path
 * Created by docker-entrypoint.sh during graceful shutdown
 */
const SHUTDOWN_MARKER = '/tmp/shutting_down';

/**
 * Convex backend health check URL
 * The Convex local backend exposes a version endpoint that indicates it's ready
 */
const CONVEX_BACKEND_URL = 'http://localhost:3210/version';

/**
 * Tale version from environment variable
 * Set at Docker build time via VERSION build argument
 * Defaults to 'dev' for local development
 */
const TALE_VERSION = process.env.TALE_VERSION || 'dev';

/**
 * Health check endpoint for Docker, Caddy, and monitoring
 *
 * Returns:
 * - 200 OK: Service is healthy and accepting traffic
 * - 503 Service Unavailable: Service is shutting down or Convex not ready
 *
 * This endpoint is used by:
 * - Docker health checks (container health status)
 * - Caddy reverse proxy (blue-green deployment traffic routing)
 * - External monitoring systems
 *
 * During blue-green deployments:
 * 1. deploy.sh sends SIGTERM to old container
 * 2. docker-entrypoint.sh creates shutdown marker
 * 3. This endpoint returns 503
 * 4. Caddy stops routing new requests to this backend
 * 5. Existing requests complete during drain period
 * 6. Container shuts down gracefully
 *
 * For zero-downtime deployments:
 * - Also checks if Convex backend is ready before reporting healthy
 * - This prevents traffic from being routed before functions are deployed
 */
export async function GET() {
  // Common headers to prevent any caching
  const noCacheHeaders = { 'Cache-Control': 'no-store' };

  // Check if we're in shutdown mode
  if (existsSync(SHUTDOWN_MARKER)) {
    return NextResponse.json(
      {
        status: 'draining',
        version: TALE_VERSION,
        service: 'tale-platform',
        timestamp: new Date().toISOString(),
        message: 'Service is shutting down, draining connections',
      },
      { status: 503, headers: noCacheHeaders }
    );
  }

  // Check if Convex backend is ready
  let convexHealthy = false;
  try {
    const response = await fetch(CONVEX_BACKEND_URL, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    convexHealthy = response.ok;
  } catch {
    convexHealthy = false;
  }

  if (!convexHealthy) {
    return NextResponse.json(
      {
        status: 'starting',
        version: TALE_VERSION,
        service: 'tale-platform',
        convex: 'unhealthy',
        timestamp: new Date().toISOString(),
        message: 'Convex backend not ready',
      },
      { status: 503, headers: noCacheHeaders }
    );
  }

  return NextResponse.json(
    {
      status: 'ok',
      version: TALE_VERSION,
      service: 'tale-platform',
      convex: 'healthy',
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: noCacheHeaders }
  );
}
