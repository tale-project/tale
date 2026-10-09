/**
 * The mock's own metrics, in the Prometheus text exposition format.
 *
 * They answer "what did the provider see": requests by route and status,
 * streams open right now, time to first token as served, tokens in and
 * out, and every fault injected — so a load report can tell a slow platform
 * from a slow (simulated) provider. Counters live in plain objects so a
 * worker can ship a snapshot to the cluster primary over IPC, where
 * snapshots merge into one exposition.
 */

/** Upper bounds of the time-to-first-token histogram, seconds. */
const TTFT_BUCKETS: readonly number[] = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30, 60,
];

/** Everything the metrics hold, as plain JSON. */
export interface MetricsSnapshot {
  /** Keyed `route + '\n' + status`. */
  readonly requests: Record<string, number>;
  readonly faults: Record<string, number>;
  readonly inflightStreams: number;
  /** Per-bucket (not cumulative) counts; the last slot is `+Inf`. */
  readonly ttftBuckets: number[];
  readonly ttftSum: number;
  readonly ttftCount: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly streamAborts: number;
  readonly embeddingInputs: number;
}

export class MockMetrics {
  private readonly requests = new Map<string, number>();
  private readonly faults = new Map<string, number>();
  private readonly ttftBuckets: number[] = new Array<number>(
    TTFT_BUCKETS.length + 1,
  ).fill(0);
  private ttftSum = 0;
  private ttftCount = 0;
  private inflight = 0;
  private inputTokens = 0;
  private cachedTokens = 0;
  private outputTokens = 0;
  private reasoningTokens = 0;
  private streamAborts = 0;
  private embeddingInputs = 0;

  recordRequest(route: string, status: string): void {
    const key = `${route}\n${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
  }

  recordFault(kind: string): void {
    this.faults.set(kind, (this.faults.get(kind) ?? 0) + 1);
  }

  streamOpened(): void {
    this.inflight += 1;
  }

  streamClosed(): void {
    this.inflight = Math.max(0, this.inflight - 1);
  }

  recordAbort(): void {
    this.streamAborts += 1;
  }

  observeTtft(seconds: number): void {
    let slot = TTFT_BUCKETS.length;
    for (let i = 0; i < TTFT_BUCKETS.length; i++) {
      if (seconds <= (TTFT_BUCKETS[i] ?? Number.POSITIVE_INFINITY)) {
        slot = i;
        break;
      }
    }
    this.ttftBuckets[slot] = (this.ttftBuckets[slot] ?? 0) + 1;
    this.ttftSum += seconds;
    this.ttftCount += 1;
  }

  /** Prompt tokens a request was billed (cached ones included). */
  addPromptTokens(input: number, cached: number): void {
    this.inputTokens += input;
    this.cachedTokens += cached;
  }

  /** Output tokens actually sent (reasoning included in `output`). */
  addOutputTokens(output: number, reasoning: number): void {
    this.outputTokens += output;
    this.reasoningTokens += reasoning;
  }

  addEmbeddingInputs(count: number): void {
    this.embeddingInputs += count;
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: Object.fromEntries(this.requests),
      faults: Object.fromEntries(this.faults),
      inflightStreams: this.inflight,
      ttftBuckets: [...this.ttftBuckets],
      ttftSum: this.ttftSum,
      ttftCount: this.ttftCount,
      inputTokens: this.inputTokens,
      cachedTokens: this.cachedTokens,
      outputTokens: this.outputTokens,
      reasoningTokens: this.reasoningTokens,
      streamAborts: this.streamAborts,
      embeddingInputs: this.embeddingInputs,
    };
  }

  render(): string {
    return renderPrometheus(this.snapshot());
  }
}

function addInto(
  target: Record<string, number>,
  source: Readonly<Record<string, number>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

/** The sum of several workers' snapshots. */
export function mergeSnapshots(
  snapshots: readonly MetricsSnapshot[],
): MetricsSnapshot {
  const requests: Record<string, number> = {};
  const faults: Record<string, number> = {};
  const ttftBuckets = new Array<number>(TTFT_BUCKETS.length + 1).fill(0);
  let inflightStreams = 0;
  let ttftSum = 0;
  let ttftCount = 0;
  let inputTokens = 0;
  let cachedTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let streamAborts = 0;
  let embeddingInputs = 0;
  for (const snapshot of snapshots) {
    addInto(requests, snapshot.requests);
    addInto(faults, snapshot.faults);
    for (let i = 0; i < ttftBuckets.length; i++) {
      ttftBuckets[i] = (ttftBuckets[i] ?? 0) + (snapshot.ttftBuckets[i] ?? 0);
    }
    inflightStreams += snapshot.inflightStreams;
    ttftSum += snapshot.ttftSum;
    ttftCount += snapshot.ttftCount;
    inputTokens += snapshot.inputTokens;
    cachedTokens += snapshot.cachedTokens;
    outputTokens += snapshot.outputTokens;
    reasoningTokens += snapshot.reasoningTokens;
    streamAborts += snapshot.streamAborts;
    embeddingInputs += snapshot.embeddingInputs;
  }
  return {
    requests,
    faults,
    inflightStreams,
    ttftBuckets,
    ttftSum,
    ttftCount,
    inputTokens,
    cachedTokens,
    outputTokens,
    reasoningTokens,
    streamAborts,
    embeddingInputs,
  };
}

function label(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function counter(
  lines: string[],
  name: string,
  help: string,
  value: number,
): void {
  lines.push(
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    `${name} ${value}`,
  );
}

/**
 * `snapshot` as a Prometheus text exposition. Every series carries the
 * `tale_load_mock_` prefix, so a scrape that also reads the platform never
 * confuses the mock's requests with the backend's.
 */
export function renderPrometheus(
  snapshot: MetricsSnapshot,
  extra: Readonly<Record<string, number>> = {},
): string {
  const lines: string[] = [];
  lines.push(
    '# HELP tale_load_mock_requests_total Requests the mock answered, by route and status (499: client left first).',
    '# TYPE tale_load_mock_requests_total counter',
  );
  for (const [key, value] of Object.entries(snapshot.requests).sort()) {
    const split = key.indexOf('\n');
    const route = key.slice(0, split);
    const status = key.slice(split + 1);
    lines.push(
      `tale_load_mock_requests_total{route="${label(route)}",status="${label(status)}"} ${value}`,
    );
  }
  lines.push(
    '# HELP tale_load_mock_inflight_streams Streams open right now.',
    '# TYPE tale_load_mock_inflight_streams gauge',
    `tale_load_mock_inflight_streams ${snapshot.inflightStreams}`,
    '# HELP tale_load_mock_stream_ttft_seconds Time from request arrival to the first streamed token.',
    '# TYPE tale_load_mock_stream_ttft_seconds histogram',
  );
  let cumulative = 0;
  for (let i = 0; i < TTFT_BUCKETS.length; i++) {
    cumulative += snapshot.ttftBuckets[i] ?? 0;
    lines.push(
      `tale_load_mock_stream_ttft_seconds_bucket{le="${TTFT_BUCKETS[i]}"} ${cumulative}`,
    );
  }
  cumulative += snapshot.ttftBuckets[TTFT_BUCKETS.length] ?? 0;
  lines.push(
    `tale_load_mock_stream_ttft_seconds_bucket{le="+Inf"} ${cumulative}`,
    `tale_load_mock_stream_ttft_seconds_sum ${snapshot.ttftSum}`,
    `tale_load_mock_stream_ttft_seconds_count ${snapshot.ttftCount}`,
  );
  counter(
    lines,
    'tale_load_mock_output_tokens_total',
    'Completion tokens sent, reasoning included.',
    snapshot.outputTokens,
  );
  counter(
    lines,
    'tale_load_mock_reasoning_tokens_total',
    'Reasoning tokens sent.',
    snapshot.reasoningTokens,
  );
  counter(
    lines,
    'tale_load_mock_input_tokens_total',
    'Prompt tokens of accepted requests, cached ones included.',
    snapshot.inputTokens,
  );
  counter(
    lines,
    'tale_load_mock_cached_tokens_total',
    'Prompt tokens served from the prompt cache.',
    snapshot.cachedTokens,
  );
  counter(
    lines,
    'tale_load_mock_embedding_inputs_total',
    'Texts embedded.',
    snapshot.embeddingInputs,
  );
  counter(
    lines,
    'tale_load_mock_stream_aborts_total',
    'Streams the client closed before they ended.',
    snapshot.streamAborts,
  );
  lines.push(
    '# HELP tale_load_mock_faults_total Faults injected, by kind.',
    '# TYPE tale_load_mock_faults_total counter',
  );
  for (const [kind, value] of Object.entries(snapshot.faults).sort()) {
    lines.push(`tale_load_mock_faults_total{kind="${label(kind)}"} ${value}`);
  }
  for (const [name, value] of Object.entries(extra)) {
    const metric = `tale_load_mock_${name}`;
    lines.push(`# TYPE ${metric} gauge`, `${metric} ${value}`);
  }
  return `${lines.join('\n')}\n`;
}
