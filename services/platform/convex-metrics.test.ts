import { describe, expect, test } from 'vitest';

import { convertVmhistogramToPrometheus } from './convex-metrics';

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
});
