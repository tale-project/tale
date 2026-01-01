import { existsSync } from 'fs';
import { NextResponse } from 'next/server';

/**
 * Shutdown marker file path
 * Created by docker-entrypoint.sh during graceful shutdown
 */
const SHUTDOWN_MARKER = '/tmp/shutting_down';

/**
 * Health check endpoint for Docker, Caddy, and monitoring
 *
 * Returns:
 * - 200 OK: Service is healthy and accepting traffic
 * - 503 Service Unavailable: Service is shutting down (draining connections)
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
 */
export async function GET() {
  // Check if we're in shutdown mode
  if (existsSync(SHUTDOWN_MARKER)) {
    return NextResponse.json(
      {
        status: 'draining',
        service: 'tale-platform',
        timestamp: new Date().toISOString(),
        message: 'Service is shutting down, draining connections',
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: 'ok',
      service: 'tale-platform',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

