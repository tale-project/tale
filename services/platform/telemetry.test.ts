import { afterEach, describe, expect, test } from 'vitest';

import { initTelemetry, metricsResponse, shutdownTelemetry } from './telemetry';

afterEach(() => {
  shutdownTelemetry();
});

describe('initTelemetry', () => {
  test('does not throw', () => {
    expect(() => initTelemetry()).not.toThrow();
  });

  test('is safe to call multiple times', () => {
    initTelemetry();
    expect(() => initTelemetry()).not.toThrow();
  });
});

describe('metricsResponse', () => {
  test('returns 200 with prometheus content type', async () => {
    initTelemetry();
    const response = await metricsResponse();
    expect(response.status).toBe(200);

    const contentType = response.headers.get('Content-Type') ?? '';
    expect(contentType).toContain('text/plain');
  });

  test('body contains process metrics', async () => {
    initTelemetry();
    const response = await metricsResponse();
    const body = await response.text();

    // prom-client default metrics include at least one of these
    const hasProcessMetrics =
      body.includes('process_cpu') ||
      body.includes('process_resident_memory') ||
      body.includes('nodejs_');
    expect(hasProcessMetrics).toBe(true);
  });
});

describe('shutdownTelemetry', () => {
  test('clears registry', async () => {
    initTelemetry();
    shutdownTelemetry();

    const response = await metricsResponse();
    const body = await response.text();
    // After clearing, no default metrics should be present
    expect(body.includes('process_cpu')).toBe(false);
  });

  test('is safe to call without init', () => {
    expect(() => shutdownTelemetry()).not.toThrow();
  });
});
