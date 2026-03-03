import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  convertVmhistogramToPrometheus,
  convexMetricsResponse,
} from './convex-metrics';

describe('convertVmhistogramToPrometheus', () => {
  test('converts vmhistogram buckets to cumulative le buckets', () => {
    const input = [
      '# HELP request_duration Request duration',
      '# TYPE request_duration vmhistogram',
      'request_duration_bucket{vmrange="1.000e-3...1.136e-3"} 5',
      'request_duration_bucket{vmrange="1.136e-3...1.292e-3"} 3',
      'request_duration_bucket{vmrange="1.292e-3...1.468e-3"} 2',
      'request_duration_sum 1.5',
      'request_duration_count 10',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# TYPE request_duration histogram');
    expect(lines).toContain('request_duration_sum 1.5');
    expect(lines).toContain('request_duration_count 10');

    // Cumulative: 5, 5+3=8, 8+2=10
    expect(lines).toContain('request_duration_bucket{le="0.001136"} 5');
    expect(lines).toContain('request_duration_bucket{le="0.001292"} 8');
    expect(lines).toContain('request_duration_bucket{le="0.001468"} 10');
    expect(lines).toContain('request_duration_bucket{le="+Inf"} 10');
  });

  test('preserves labels while removing vmrange', () => {
    const input = [
      '# HELP latency Latency',
      '# TYPE latency vmhistogram',
      'latency_bucket{method="GET",vmrange="1.000e-1...2.000e-1"} 4',
      'latency_bucket{method="GET",vmrange="2.000e-1...3.000e-1"} 6',
      'latency_sum{method="GET"} 2.5',
      'latency_count{method="GET"} 10',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('latency_bucket{method="GET",le="0.2"} 4');
    expect(lines).toContain('latency_bucket{method="GET",le="0.3"} 10');
    expect(lines).toContain('latency_bucket{method="GET",le="+Inf"} 10');
  });

  test('handles multiple label groups independently', () => {
    const input = [
      '# TYPE rpc_duration vmhistogram',
      'rpc_duration_bucket{service="a",vmrange="1.000e0...2.000e0"} 3',
      'rpc_duration_sum{service="a"} 4.5',
      'rpc_duration_count{service="a"} 3',
      'rpc_duration_bucket{service="b",vmrange="1.000e0...2.000e0"} 7',
      'rpc_duration_sum{service="b"} 10.5',
      'rpc_duration_count{service="b"} 7',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('rpc_duration_bucket{service="a",le="2"} 3');
    expect(lines).toContain('rpc_duration_bucket{service="a",le="+Inf"} 3');
    expect(lines).toContain('rpc_duration_bucket{service="b",le="2"} 7');
    expect(lines).toContain('rpc_duration_bucket{service="b",le="+Inf"} 7');
  });

  test('passes counter metrics through unchanged', () => {
    const input = [
      '# HELP http_requests_total Total requests',
      '# TYPE http_requests_total counter',
      'http_requests_total{method="GET"} 100',
      'http_requests_total{method="POST"} 50',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    expect(result).toBe(input);
  });

  test('passes gauge metrics through unchanged', () => {
    const input = [
      '# HELP temperature Current temperature',
      '# TYPE temperature gauge',
      'temperature 23.5',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    expect(result).toBe(input);
  });

  test('handles mixed metric types', () => {
    const input = [
      '# HELP requests_total Counter',
      '# TYPE requests_total counter',
      'requests_total 42',
      '# HELP duration Histogram',
      '# TYPE duration vmhistogram',
      'duration_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'duration_sum 0.15',
      'duration_count 10',
      '# HELP goroutines Gauge',
      '# TYPE goroutines gauge',
      'goroutines 8',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('requests_total 42');
    expect(lines).toContain('# TYPE duration histogram');
    expect(lines).toContain('duration_bucket{le="0.02"} 10');
    expect(lines).toContain('duration_bucket{le="+Inf"} 10');
    expect(lines).toContain('goroutines 8');
    // No vmhistogram or vmrange in output
    expect(result).not.toContain('vmhistogram');
    expect(result).not.toContain('vmrange');
  });

  test('sorts buckets by le ascending regardless of input order', () => {
    const input = [
      '# TYPE latency vmhistogram',
      'latency_bucket{vmrange="5.000e-1...1.000e0"} 2',
      'latency_bucket{vmrange="1.000e-2...5.000e-2"} 8',
      'latency_bucket{vmrange="5.000e-2...1.000e-1"} 5',
      'latency_sum 3.0',
      'latency_count 15',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    // Sorted: 0.05 (8), 0.1 (8+5=13), 1 (13+2=15)
    expect(lines).toContain('latency_bucket{le="0.05"} 8');
    expect(lines).toContain('latency_bucket{le="0.1"} 13');
    expect(lines).toContain('latency_bucket{le="1"} 15');
    expect(lines).toContain('latency_bucket{le="+Inf"} 15');
  });

  test('handles empty input', () => {
    expect(convertVmhistogramToPrometheus('')).toBe('');
  });

  test('handles vmrange as the first label', () => {
    const input = [
      '# TYPE latency vmhistogram',
      'latency_bucket{vmrange="1.000e-1...2.000e-1",method="GET"} 4',
      'latency_bucket{vmrange="2.000e-1...3.000e-1",method="GET"} 6',
      'latency_sum{method="GET"} 2.5',
      'latency_count{method="GET"} 10',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('latency_bucket{method="GET",le="0.2"} 4');
    expect(lines).toContain('latency_bucket{method="GET",le="0.3"} 10');
    expect(lines).toContain('latency_bucket{method="GET",le="+Inf"} 10');
    expect(result).not.toContain('vmrange');
  });

  test('flushes remaining buckets when _count is missing', () => {
    const input = [
      '# TYPE latency vmhistogram',
      'latency_bucket{vmrange="1.000e-1...2.000e-1"} 4',
      'latency_bucket{vmrange="2.000e-1...3.000e-1"} 6',
      'latency_sum 2.5',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# TYPE latency histogram');
    expect(lines).toContain('latency_bucket{le="0.2"} 4');
    expect(lines).toContain('latency_bucket{le="0.3"} 10');
    expect(lines).toContain('latency_bucket{le="+Inf"} 10');
  });

  test('handles sequential vmhistogram metrics', () => {
    const input = [
      '# TYPE alpha vmhistogram',
      'alpha_bucket{vmrange="1.000e0...2.000e0"} 3',
      'alpha_sum 4.5',
      'alpha_count 3',
      '# TYPE beta vmhistogram',
      'beta_bucket{vmrange="5.000e-1...1.000e0"} 7',
      'beta_sum 5.0',
      'beta_count 7',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# TYPE alpha histogram');
    expect(lines).toContain('alpha_bucket{le="2"} 3');
    expect(lines).toContain('alpha_bucket{le="+Inf"} 3');

    expect(lines).toContain('# TYPE beta histogram');
    expect(lines).toContain('beta_bucket{le="1"} 7');
    expect(lines).toContain('beta_bucket{le="+Inf"} 7');
  });

  test('handles _count without braces', () => {
    const input = [
      '# TYPE ops vmhistogram',
      'ops_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'ops_sum 0.15',
      'ops_count 10',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('ops_bucket{le="0.02"} 10');
    expect(lines).toContain('ops_bucket{le="+Inf"} 10');
    expect(lines).toContain('ops_count 10');
    expect(lines).toContain('ops_sum 0.15');
  });

  test('handles vmrange with zero bucket at start', () => {
    const input = [
      '# TYPE ops vmhistogram',
      'ops_bucket{vmrange="0...1.000e-9"} 100',
      'ops_bucket{vmrange="1.000e-1...2.000e-1"} 5',
      'ops_sum 0.75',
      'ops_count 105',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    // The "0...1e-9" range has upper bound 1e-9
    expect(lines).toContain('ops_bucket{le="1e-9"} 100');
    expect(lines).toContain('ops_bucket{le="0.2"} 105');
    expect(lines).toContain('ops_bucket{le="+Inf"} 105');
  });

  test('handles +Inf vmrange bucket', () => {
    const input = [
      '# TYPE big vmhistogram',
      'big_bucket{vmrange="1.000e0...2.000e0"} 5',
      'big_bucket{vmrange="1.000e+18...+Inf"} 2',
      'big_sum 100',
      'big_count 7',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('big_bucket{le="2"} 5');
    expect(lines).toContain('big_bucket{le="+Inf"} 7');
    expect(result).not.toContain('le="NaN"');
    expect(result).not.toContain('le="Infinity"');
    expect(result).not.toContain('vmrange');
  });

  test('handles Inf without plus sign in vmrange', () => {
    const input = [
      '# TYPE big vmhistogram',
      'big_bucket{vmrange="1.000e0...2.000e0"} 5',
      'big_bucket{vmrange="1.000e+18...Inf"} 2',
      'big_sum 100',
      'big_count 7',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('big_bucket{le="2"} 5');
    expect(lines).toContain('big_bucket{le="+Inf"} 7');
    expect(result).not.toContain('le="NaN"');
    expect(result).not.toContain('le="Infinity"');
    expect(result).not.toContain('vmrange');
  });

  test('handles metric name containing _count', () => {
    const input = [
      '# TYPE retry_count vmhistogram',
      'retry_count_bucket{vmrange="1.000e-1...2.000e-1"} 3',
      'retry_count_bucket{vmrange="2.000e-1...3.000e-1"} 7',
      'retry_count_sum 1.5',
      'retry_count_count 10',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# TYPE retry_count histogram');
    expect(lines).toContain('retry_count_bucket{le="0.2"} 3');
    expect(lines).toContain('retry_count_bucket{le="0.3"} 10');
    expect(lines).toContain('retry_count_bucket{le="+Inf"} 10');
    expect(lines).toContain('retry_count_sum 1.5');
    expect(lines).toContain('retry_count_count 10');
  });

  test('emits buckets before _sum and _count (Prometheus ordering)', () => {
    const input = [
      '# TYPE latency vmhistogram',
      'latency_bucket{vmrange="1.000e-1...2.000e-1"} 4',
      'latency_bucket{vmrange="2.000e-1...3.000e-1"} 6',
      'latency_sum 2.5',
      'latency_count 10',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    const firstBucketIdx = lines.findIndex((l) => l.includes('_bucket{'));
    const infBucketIdx = lines.findIndex((l) => l.includes('le="+Inf"'));
    const sumIdx = lines.findIndex((l) => l.includes('_sum'));
    const countIdx = lines.findIndex((l) => l.includes('_count'));

    // Prometheus convention: buckets → +Inf → _sum → _count
    expect(firstBucketIdx).toBeLessThan(infBucketIdx);
    expect(infBucketIdx).toBeLessThan(sumIdx);
    expect(sumIdx).toBeLessThan(countIdx);
  });

  test('handles CRLF line endings', () => {
    const input = [
      '# TYPE ops vmhistogram',
      'ops_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'ops_sum 0.15',
      'ops_count 10',
    ].join('\r\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# TYPE ops histogram');
    expect(lines).toContain('ops_bucket{le="0.02"} 10');
    expect(lines).toContain('ops_bucket{le="+Inf"} 10');
  });

  test('handles vmrange in the middle of multiple labels', () => {
    const input = [
      '# TYPE rpc vmhistogram',
      'rpc_bucket{service="api",vmrange="1.000e0...2.000e0",region="us"} 5',
      'rpc_sum{service="api",region="us"} 7.5',
      'rpc_count{service="api",region="us"} 5',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('rpc_bucket{service="api",region="us",le="2"} 5');
    expect(lines).toContain(
      'rpc_bucket{service="api",region="us",le="+Inf"} 5',
    );
    expect(result).not.toContain('vmrange');
  });

  test('emits +Inf bucket when only _sum and _count exist without buckets', () => {
    const input = [
      '# TYPE empty vmhistogram',
      'empty_sum 0',
      'empty_count 0',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# TYPE empty histogram');
    expect(lines).toContain('empty_bucket{le="+Inf"} 0');
    expect(lines).toContain('empty_sum 0');
    expect(lines).toContain('empty_count 0');
  });

  test('preserves HELP lines for vmhistogram metrics', () => {
    const input = [
      '# HELP latency Request latency in seconds',
      '# TYPE latency vmhistogram',
      'latency_bucket{vmrange="1.000e-1...2.000e-1"} 4',
      'latency_sum 0.6',
      'latency_count 4',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    const lines = result.split('\n');

    expect(lines).toContain('# HELP latency Request latency in seconds');
    expect(lines).toContain('# TYPE latency histogram');
  });

  test('does not trigger on _count substring in non-suffix position', () => {
    // A gauge metric named "error_count_total" should pass through unchanged
    const input = [
      '# TYPE error_count_total counter',
      'error_count_total 42',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    expect(result).toBe(input);
  });

  test('produces exact expected output for a simple histogram', () => {
    const input = [
      '# TYPE ops vmhistogram',
      'ops_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'ops_sum 0.15',
      'ops_count 10',
    ].join('\n');

    const expected = [
      '# TYPE ops histogram',
      'ops_bucket{le="0.02"} 10',
      'ops_bucket{le="+Inf"} 10',
      'ops_sum 0.15',
      'ops_count 10',
    ].join('\n');

    expect(convertVmhistogramToPrometheus(input)).toBe(expected);
  });

  test('produces exact output for a labeled histogram', () => {
    const input = [
      '# HELP rpc_duration RPC duration',
      '# TYPE rpc_duration vmhistogram',
      'rpc_duration_bucket{service="a",vmrange="1.000e0...2.000e0"} 3',
      'rpc_duration_bucket{service="a",vmrange="2.000e0...3.000e0"} 2',
      'rpc_duration_sum{service="a"} 7.5',
      'rpc_duration_count{service="a"} 5',
      'rpc_duration_bucket{service="b",vmrange="1.000e0...2.000e0"} 7',
      'rpc_duration_sum{service="b"} 10.5',
      'rpc_duration_count{service="b"} 7',
    ].join('\n');

    const expected = [
      '# HELP rpc_duration RPC duration',
      '# TYPE rpc_duration histogram',
      'rpc_duration_bucket{service="a",le="2"} 3',
      'rpc_duration_bucket{service="a",le="3"} 5',
      'rpc_duration_bucket{service="a",le="+Inf"} 5',
      'rpc_duration_sum{service="a"} 7.5',
      'rpc_duration_count{service="a"} 5',
      'rpc_duration_bucket{service="b",le="2"} 7',
      'rpc_duration_bucket{service="b",le="+Inf"} 7',
      'rpc_duration_sum{service="b"} 10.5',
      'rpc_duration_count{service="b"} 7',
    ].join('\n');

    expect(convertVmhistogramToPrometheus(input)).toBe(expected);
  });

  test('produces exact output for mixed metric types', () => {
    const input = [
      '# HELP requests_total Counter',
      '# TYPE requests_total counter',
      'requests_total 42',
      '# HELP duration Histogram',
      '# TYPE duration vmhistogram',
      'duration_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'duration_bucket{vmrange="2.000e-2...5.000e-2"} 5',
      'duration_sum 0.45',
      'duration_count 15',
      '# HELP goroutines Gauge',
      '# TYPE goroutines gauge',
      'goroutines 8',
    ].join('\n');

    const expected = [
      '# HELP requests_total Counter',
      '# TYPE requests_total counter',
      'requests_total 42',
      '# HELP duration Histogram',
      '# TYPE duration histogram',
      'duration_bucket{le="0.02"} 10',
      'duration_bucket{le="0.05"} 15',
      'duration_bucket{le="+Inf"} 15',
      'duration_sum 0.45',
      'duration_count 15',
      '# HELP goroutines Gauge',
      '# TYPE goroutines gauge',
      'goroutines 8',
    ].join('\n');

    expect(convertVmhistogramToPrometheus(input)).toBe(expected);
  });

  test('handles trailing newline in input', () => {
    const input = [
      '# TYPE ops vmhistogram',
      'ops_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'ops_sum 0.15',
      'ops_count 10',
      '',
    ].join('\n');

    const result = convertVmhistogramToPrometheus(input);
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('convexMetricsResponse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns converted metrics with Prometheus content type', async () => {
    const raw = [
      '# TYPE ops vmhistogram',
      'ops_bucket{vmrange="1.000e-2...2.000e-2"} 10',
      'ops_sum 0.15',
      'ops_count 10',
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(raw, { status: 200 }))),
    );

    const res = await convexMetricsResponse();

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
    const body = await res.text();
    expect(body).toContain('# TYPE ops histogram');
    expect(body).not.toContain('vmrange');
  });

  test('returns raw metrics when format=raw', async () => {
    const raw = '# TYPE ops vmhistogram\nops_count 10\n';

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(raw, { status: 200 }))),
    );

    const res = await convexMetricsResponse('raw');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe(raw);
  });

  test('returns 502 on upstream non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 503 }))),
    );

    const res = await convexMetricsResponse();

    expect(res.status).toBe(502);
    expect(await res.text()).toBe('Convex metrics unavailable');
  });

  test('returns 502 on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Connection refused'))),
    );

    const res = await convexMetricsResponse();

    expect(res.status).toBe(502);
    expect(await res.text()).toBe('Convex metrics unavailable');
  });

  test('returns 500 on conversion failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('raw metrics data', { status: 200 })),
      ),
    );

    const throwingConverter = () => {
      throw new Error('conversion failed');
    };
    const res = await convexMetricsResponse(null, throwingConverter);

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Convex metrics conversion failed');
  });
});
