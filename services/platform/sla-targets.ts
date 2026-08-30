/**
 * Response-time SLA targets — the single source of truth.
 *
 * Tale carries two contractual response-time budgets:
 *
 *   dialog_ttft     interactive chat / dialog input — mean ~1 s
 *   long_operation  long-running work (evaluations) — mean ~40 s
 *
 * The measurement primitives already exist (the backend's request histograms
 * on `/metrics/backend`, TTFT metadata, cold-load tracing). What was missing —
 * and what this module adds — is the SLA layer on top of them:
 *
 *   1. The targets themselves, defined once here so code, dashboards, alert
 *      rules and docs cannot drift.
 *   2. `registerSlaTargetMetrics` — exposes each target as a
 *      `tale_sla_target_seconds` gauge on `/metrics` (via `/metrics/platform`),
 *      so a Grafana panel can draw the budget line straight from Prometheus
 *      instead of hard-coding it.
 *   3. `renderSlaPrometheusRules` / `slaRulesResponse` — generate the
 *      recording + alerting rules that aggregate the underlying latency
 *      histogram into the chosen statistic and page/warn when it breaches the
 *      budget. Served read-only at `/metrics/sla-rules` so operators load the
 *      ready-made rules instead of hand-copying thresholds.
 *
 * The `metric` field names the latency histogram each budget is measured
 * against. It defaults to a `tale_*_seconds` series the operator produces from
 * the backend's request-duration histogram (a relabel/recording step
 * documented in the observability guide), so the SLA aggregation stays correct
 * regardless of the exact built-in series the backend emits.
 */

import * as client from 'prom-client';
import { stringify } from 'yaml';

/** Aggregation a target is verified against. */
export type SlaStatistic = 'mean' | 'p95' | 'p99';

export interface SlaTarget {
  /** Stable id; the `sla` metric label and the alert-name stem. */
  id: string;
  /** Human-readable title for dashboards and docs. */
  title: string;
  /** What the budget covers. */
  description: string;
  /** The statistic the target is measured against. */
  statistic: SlaStatistic;
  /** Budget in seconds — the statistic must stay at or below this. */
  targetSeconds: number;
  /** Rolling window the statistic is computed over (PromQL duration). */
  window: string;
  /** How long a breach must persist before the alert fires (PromQL duration). */
  alertFor: string;
  /** Alert severity label. */
  severity: 'page' | 'warn';
  /**
   * Latency histogram base name (without `_bucket`/`_sum`/`_count`) carrying
   * this operation's timings. Operators map it to their backend series per the
   * observability docs.
   */
  metric: string;
}

export const SLA_TARGETS: readonly SlaTarget[] = [
  {
    id: 'dialog_ttft',
    title: 'Dialog input response time',
    description:
      'Mean time-to-first-token for an interactive chat / dialog turn.',
    statistic: 'mean',
    targetSeconds: 1,
    window: '30m',
    alertFor: '15m',
    severity: 'warn',
    metric: 'tale_dialog_ttft_seconds',
  },
  {
    id: 'long_operation',
    title: 'Long operation response time',
    description:
      'Mean end-to-end time for long-running operations such as evaluations.',
    statistic: 'mean',
    targetSeconds: 40,
    window: '6h',
    alertFor: '30m',
    severity: 'warn',
    metric: 'tale_long_operation_seconds',
  },
];

const SLA_TARGET_METRIC = 'tale_sla_target_seconds';

/** Throw on duplicate ids so two budgets can never share a series/alert name. */
function assertUniqueIds(targets: readonly SlaTarget[]): void {
  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.id)) {
      throw new Error(`Duplicate SLA target id: ${t.id}`);
    }
    seen.add(t.id);
  }
}

/** Recording-rule name for a target's aggregated statistic. */
export function slaRecordingRuleName(target: SlaTarget): string {
  return `tale_sla_${target.id}:${target.statistic}${target.window}`;
}

/** Alert name for a target, e.g. `TaleSlaDialogTtftBreached`. */
export function slaAlertName(target: SlaTarget): string {
  const camel = target.id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `TaleSla${camel}Breached`;
}

/** PromQL that aggregates a target's histogram into its chosen statistic. */
function statisticExpr(target: SlaTarget): string {
  const { metric, window, statistic } = target;
  if (statistic === 'mean') {
    return `rate(${metric}_sum[${window}]) / rate(${metric}_count[${window}])`;
  }
  const quantile = statistic === 'p95' ? 0.95 : 0.99;
  return `histogram_quantile(${quantile}, sum by (le) (rate(${metric}_bucket[${window}])))`;
}

/**
 * Render the Prometheus recording + alerting rules for the given targets as a
 * `rule_files`-ready YAML document. A recording rule materialises each budget's
 * statistic; an alert fires when it stays above the target for `alertFor`.
 */
export function renderSlaPrometheusRules(
  targets: readonly SlaTarget[] = SLA_TARGETS,
): string {
  assertUniqueIds(targets);

  const recordingRules = targets.map((t) => ({
    record: slaRecordingRuleName(t),
    expr: statisticExpr(t),
    labels: { sla: t.id },
  }));

  const alertRules = targets.map((t) => ({
    alert: slaAlertName(t),
    expr: `${slaRecordingRuleName(t)} > ${t.targetSeconds}`,
    for: t.alertFor,
    labels: { severity: t.severity, sla: t.id },
    annotations: {
      summary: `${t.title}: ${t.statistic} response time over ${t.window} exceeds the ${t.targetSeconds}s SLA`,
      description: t.description,
    },
  }));

  const groups: Record<string, unknown>[] = [];
  if (recordingRules.length > 0) {
    groups.push({ name: 'tale-sla-recording', rules: recordingRules });
    groups.push({ name: 'tale-sla-alerts', rules: alertRules });
  }

  // `lineWidth: 0` keeps PromQL expressions on a single line — folded scalars
  // are valid YAML but harder to read and copy.
  return stringify({ groups }, { lineWidth: 0 });
}

/**
 * Register a `tale_sla_target_seconds` gauge — one sample per target — so the
 * contractual budget is queryable in Prometheus and drawable as a threshold
 * line on latency dashboards.
 */
export function registerSlaTargetMetrics(
  registry: client.Registry = client.register,
  targets: readonly SlaTarget[] = SLA_TARGETS,
): void {
  assertUniqueIds(targets);

  const gauge = new client.Gauge({
    name: SLA_TARGET_METRIC,
    help: 'Response-time SLA target in seconds, by operation and statistic.',
    labelNames: ['sla', 'statistic'],
    registers: [registry],
  });

  for (const t of targets) {
    gauge.set({ sla: t.id, statistic: t.statistic }, t.targetSeconds);
  }
}

/** Serve the generated SLA rules as YAML at `/metrics/sla-rules`. */
export function slaRulesResponse(): Response {
  return new Response(renderSlaPrometheusRules(), {
    headers: { 'Content-Type': 'application/yaml; charset=utf-8' },
  });
}
