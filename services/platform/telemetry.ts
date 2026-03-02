/**
 * Prometheus metrics for Tale Platform (Bun static server).
 *
 * Collects process-level metrics (CPU, memory, event loop, GC)
 * and exposes them at GET /metrics in Prometheus text format.
 *
 * HTTP request metrics are not included because this server
 * only serves static files — the real backend is Convex.
 */

import client from 'prom-client';

export function initTelemetry() {
  client.collectDefaultMetrics();
}

export async function metricsResponse(): Promise<Response> {
  return new Response(await client.register.metrics(), {
    headers: { 'Content-Type': client.register.contentType },
  });
}
