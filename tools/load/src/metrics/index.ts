/** The metrics layer: histograms, the per-process registry, thresholds. */

export { LatencyHistogram } from './histogram.ts';
export type {
  LatencyHistogramOptions,
  SignificantDigits,
} from './histogram.ts';
export {
  MetricsRegistry,
  formatSummary,
  mergeSnapshots,
  metricsSnapshotSchema,
  summarize,
} from './registry.ts';
export type {
  ErrorSnapshot,
  GaugeSnapshot,
  MetricsRegistryOptions,
  MetricsSnapshot,
  MetricsSummary,
  RecentWindow,
  SeriesWindowSnapshot,
  ShardInfo,
  TimingKind,
  TimingRow,
  TimingSnapshot,
} from './registry.ts';
export {
  evaluateThresholds,
  parseThresholds,
  thresholdsSchema,
} from './thresholds.ts';
export type {
  Threshold,
  ThresholdOperator,
  ThresholdResult,
  ThresholdStat,
} from './thresholds.ts';
