/**
 * Stress test metrics collector
 *
 * Tracks workflow execution outcomes, latencies, and failure patterns.
 */

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stuck';

interface ExecutionRecord {
  executionId: string;
  startedAt: number;
  completedAt?: number;
  status: ExecutionStatus;
  error?: string;
}

interface MetricsReport {
  total: number;
  completed: number;
  failed: number;
  stuck: number;
  successRate: number;
  latency: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    avg: number;
  };
  failurePatterns: Record<string, number>;
  durationMs: number;
}

export class MetricsCollector {
  private executions = new Map<string, ExecutionRecord>();
  private startTime = Date.now();

  track(executionId: string) {
    this.executions.set(executionId, {
      executionId,
      startedAt: Date.now(),
      status: 'pending',
    });
  }

  update(executionId: string, status: ExecutionStatus, error?: string) {
    const record = this.executions.get(executionId);
    if (!record) return;

    record.status = status;
    if (status === 'completed' || status === 'failed') {
      record.completedAt = Date.now();
    }
    if (error) {
      record.error = error;
    }
  }

  markStuck(executionId: string) {
    const record = this.executions.get(executionId);
    if (record && record.status !== 'completed' && record.status !== 'failed') {
      record.status = 'stuck';
      record.completedAt = Date.now();
    }
  }

  report(): MetricsReport {
    const records = Array.from(this.executions.values());
    const completed = records.filter((r) => r.status === 'completed');
    const failed = records.filter((r) => r.status === 'failed');
    const stuck = records.filter((r) => r.status === 'stuck');

    const latencies = records
      .filter(
        (r): r is ExecutionRecord & { completedAt: number } =>
          r.completedAt != null,
      )
      .map((r) => r.completedAt - r.startedAt)
      .sort((a, b) => a - b);

    const failurePatterns: Record<string, number> = {};
    for (const record of failed) {
      const pattern = record.error || 'Unknown error';
      const key =
        pattern.length > 100 ? pattern.slice(0, 100) + '...' : pattern;
      failurePatterns[key] = (failurePatterns[key] || 0) + 1;
    }

    return {
      total: records.length,
      completed: completed.length,
      failed: failed.length,
      stuck: stuck.length,
      successRate: records.length > 0 ? completed.length / records.length : 0,
      latency: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        min: latencies[0] ?? 0,
        max: latencies[latencies.length - 1] ?? 0,
        avg:
          latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0,
      },
      failurePatterns,
      durationMs: Date.now() - this.startTime,
    };
  }

  printReport() {
    const r = this.report();
    console.log('\n' + '='.repeat(60));
    console.log('STRESS TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total workflows:     ${r.total}`);
    console.log(`Completed:           ${r.completed}`);
    console.log(`Failed:              ${r.failed}`);
    console.log(`Stuck:               ${r.stuck}`);
    console.log(`Success rate:        ${(r.successRate * 100).toFixed(1)}%`);
    console.log(`Duration:            ${(r.durationMs / 1000).toFixed(1)}s`);
    console.log('');
    console.log('Latency (ms):');
    console.log(`  p50:               ${r.latency.p50}`);
    console.log(`  p95:               ${r.latency.p95}`);
    console.log(`  p99:               ${r.latency.p99}`);
    console.log(`  min:               ${r.latency.min}`);
    console.log(`  max:               ${r.latency.max}`);
    console.log(`  avg:               ${Math.round(r.latency.avg)}`);

    if (Object.keys(r.failurePatterns).length > 0) {
      console.log('');
      console.log('Failure patterns:');
      for (const [pattern, count] of Object.entries(r.failurePatterns)) {
        console.log(`  [${count}x] ${pattern}`);
      }
    }

    console.log('='.repeat(60));
    return r;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}
