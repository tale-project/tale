/**
 * Prometheus metrics for Tale Platform (Express static server).
 *
 * Collects process-level metrics (CPU, memory, event loop, GC)
 * and exposes them at GET /metrics in Prometheus text format.
 *
 * HTTP request metrics are not included because this Express server
 * only serves static files — the real backend is Convex (Rust).
 */

import client from 'prom-client';

export function initTelemetry(app) {
  client.collectDefaultMetrics();

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });
}
