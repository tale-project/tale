/**
 * Prometheus metrics for Tale Platform (Bun static server).
 *
 * Collects process-level metrics (CPU, memory, event loop, GC)
 * and exposes them at GET /metrics in Prometheus text format.
 *
 * HTTP request metrics are not included because this server
 * only serves static files — the real backend is Convex.
 */

import * as client from 'prom-client';

let initialized = false;

export function initTelemetry() {
  if (initialized) return;
  client.collectDefaultMetrics();
  initialized = true;
}

export function shutdownTelemetry() {
  client.register.clear();
  initialized = false;
}

export async function metricsResponse(): Promise<Response> {
  try {
    return new Response(await client.register.metrics(), {
      headers: { 'Content-Type': client.register.contentType },
    });
  } catch {
    return new Response('Metrics unavailable', { status: 500 });
  }
}
