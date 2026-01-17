#!/usr/bin/env npx tsx
/**
 * Concurrent read test for RAG service.
 *
 * This script tests concurrent search requests to the RAG service to measure
 * performance, throughput, and error rates under load.
 *
 * Usage: npx tsx concurrent_read_test.ts
 */

interface RequestResult {
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
  totalResults: number;
}

interface TestSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTimeSeconds: number;
  requestsPerSecond: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRatePercent: number;
}

const RAG_BASE_URL = "http://localhost:8001";
const DEFAULT_DATASET = "tale_team_ddd123";
const TEST_QUERIES = [
  "what is the document about?",
  "key information",
  "main topic",
  "summary",
  "important details",
];

async function makeSearchRequest(
  query: string,
  datasets: string[],
  topK = 5
): Promise<RequestResult> {
  const startTime = performance.now();

  const payload = {
    query,
    search_type: "CHUNKS",
    top_k: topK,
    datasets,
    include_metadata: true,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${RAG_BASE_URL}/api/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = performance.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        latencyMs,
        statusCode: response.status,
        totalResults: data.total_results ?? 0,
      };
    } else {
      const errorText = await response.text();
      return {
        success: false,
        latencyMs,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        totalResults: 0,
      };
    }
  } catch (e) {
    const latencyMs = performance.now() - startTime;
    const error = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      latencyMs,
      error: error.includes("abort") ? "Request timeout" : error,
      totalResults: 0,
    };
  }
}

function percentile(sortedData: number[], p: number): number {
  if (sortedData.length === 0) return 0;
  const k = (sortedData.length - 1) * (p / 100);
  const f = Math.floor(k);
  const c = Math.min(f + 1, sortedData.length - 1);
  return sortedData[f] + (k - f) * (sortedData[c] - sortedData[f]);
}

async function runConcurrentTest(
  numRequests: number,
  concurrency: number,
  datasets: string[]
): Promise<TestSummary> {
  console.log("\n" + "=".repeat(60));
  console.log("Running concurrent read test");
  console.log(`  Total requests: ${numRequests}`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Datasets: ${datasets.join(", ")}`);
  console.log("=".repeat(60) + "\n");

  const results: RequestResult[] = [];
  const errorsSeenMap = new Map<string, number>();
  let completed = 0;
  let inFlight = 0;

  const startTime = performance.now();

  const executeRequest = async (index: number): Promise<void> => {
    const query = TEST_QUERIES[index % TEST_QUERIES.length];
    const result = await makeSearchRequest(query, datasets);
    results.push(result);

    if (!result.success && result.error) {
      const errorKey = result.error.slice(0, 80);
      errorsSeenMap.set(errorKey, (errorsSeenMap.get(errorKey) ?? 0) + 1);
    }

    completed++;
    if (completed % 10 === 0 || completed === numRequests) {
      console.log(`  Progress: ${completed}/${numRequests} requests completed`);
    }
  };

  interface TrackedPromise {
    promise: Promise<void>;
    settled: boolean;
  }
  const pending: TrackedPromise[] = [];
  let nextIndex = 0;

  while (nextIndex < numRequests || pending.length > 0) {
    while (inFlight < concurrency && nextIndex < numRequests) {
      const index = nextIndex++;
      inFlight++;
      const tracked: TrackedPromise = {
        promise: null as unknown as Promise<void>,
        settled: false,
      };
      tracked.promise = executeRequest(index).finally(() => {
        inFlight--;
        tracked.settled = true;
      });
      pending.push(tracked);
    }

    if (pending.length > 0) {
      await Promise.race(pending.map((t) => t.promise));
      // Remove all settled promises
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].settled) {
          pending.splice(i, 1);
        }
      }
    }
  }

  const totalTime = (performance.now() - startTime) / 1000;

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (errorsSeenMap.size > 0) {
    console.log("\n  Error breakdown:");
    const sortedErrors = [...errorsSeenMap.entries()].sort(
      (a, b) => b[1] - a[1]
    );
    for (const [error, count] of sortedErrors) {
      console.log(`    [${count}x] ${error}`);
    }
  }

  const latencies = results.map((r) => r.latencyMs);
  const sortedLatencies = [...latencies].sort((a, b) => a - b);

  const avg = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;

  return {
    totalRequests: numRequests,
    successfulRequests: successful.length,
    failedRequests: failed.length,
    totalTimeSeconds: totalTime,
    requestsPerSecond: totalTime > 0 ? numRequests / totalTime : 0,
    avgLatencyMs: avg,
    minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
    p50LatencyMs: percentile(sortedLatencies, 50),
    p95LatencyMs: percentile(sortedLatencies, 95),
    p99LatencyMs: percentile(sortedLatencies, 99),
    errorRatePercent:
      numRequests > 0 ? (failed.length / numRequests) * 100 : 0,
  };
}

function printSummary(summary: TestSummary): void {
  console.log("\n" + "=".repeat(60));
  console.log("TEST RESULTS SUMMARY");
  console.log("=".repeat(60));
  console.log(`  Total Requests:      ${summary.totalRequests}`);
  console.log(`  Successful:          ${summary.successfulRequests}`);
  console.log(`  Failed:              ${summary.failedRequests}`);
  console.log(`  Error Rate:          ${summary.errorRatePercent.toFixed(2)}%`);
  console.log("=".repeat(60));
  console.log("PERFORMANCE METRICS");
  console.log("=".repeat(60));
  console.log(`  Total Time:          ${summary.totalTimeSeconds.toFixed(2)}s`);
  console.log(
    `  Throughput:          ${summary.requestsPerSecond.toFixed(2)} req/s`
  );
  console.log("=".repeat(60));
  console.log("LATENCY (ms)");
  console.log("=".repeat(60));
  console.log(`  Min:                 ${summary.minLatencyMs.toFixed(2)}`);
  console.log(`  Avg:                 ${summary.avgLatencyMs.toFixed(2)}`);
  console.log(`  Max:                 ${summary.maxLatencyMs.toFixed(2)}`);
  console.log(`  P50 (Median):        ${summary.p50LatencyMs.toFixed(2)}`);
  console.log(`  P95:                 ${summary.p95LatencyMs.toFixed(2)}`);
  console.log(`  P99:                 ${summary.p99LatencyMs.toFixed(2)}`);
  console.log("=".repeat(60) + "\n");
}

async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${RAG_BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      console.log(`RAG service is healthy:`, data);
      return true;
    } else {
      console.log(`RAG service returned status ${response.status}`);
      return false;
    }
  } catch (e) {
    console.log(`Failed to connect to RAG service: ${e}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("RAG CONCURRENT READ TEST");
  console.log("=".repeat(60));

  if (!(await checkHealth())) {
    console.log("ERROR: RAG service is not available. Exiting.");
    process.exit(1);
  }

  const datasets = [DEFAULT_DATASET];

  const testConfigs = [
    { numRequests: 10, concurrency: 5 },
    { numRequests: 50, concurrency: 10 },
    { numRequests: 100, concurrency: 20 },
  ];

  const allSummaries: Array<{ config: typeof testConfigs[0]; summary: TestSummary }> = [];

  for (const config of testConfigs) {
    const summary = await runConcurrentTest(
      config.numRequests,
      config.concurrency,
      datasets
    );
    printSummary(summary);
    allSummaries.push({ config, summary });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n" + "=".repeat(60));
  console.log("FINAL COMPARISON");
  console.log("=".repeat(60));
  console.log(
    `${"Concurrency".padEnd(12)} ${"Requests".padEnd(10)} ${"RPS".padEnd(
      10
    )} ${"Avg(ms)".padEnd(10)} ${"P95(ms)".padEnd(10)} ${"Errors".padEnd(10)}`
  );
  console.log("-".repeat(62));
  for (const { config, summary } of allSummaries) {
    console.log(
      `${String(config.concurrency).padEnd(12)} ` +
        `${String(config.numRequests).padEnd(10)} ` +
        `${summary.requestsPerSecond.toFixed(2).padEnd(10)} ` +
        `${summary.avgLatencyMs.toFixed(2).padEnd(10)} ` +
        `${summary.p95LatencyMs.toFixed(2).padEnd(10)} ` +
        `${String(summary.failedRequests).padEnd(10)}`
    );
  }
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);
