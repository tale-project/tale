/** The metrics layer: histograms, the per-process registry, thresholds. */

export {
  HIGHEST_TRACKABLE_US,
  LatencyHistogram,
  mergeEncoded,
} from './histogram.ts';
export type {
  LatencyHistogramOptions,
  SignificantDigits,
} from './histogram.ts';
export {
  DEFAULT_RETENTION_MS,
  DEFAULT_WINDOW_MS,
  ERROR_DETAIL_MAX,
  ERROR_SAMPLES,
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
  THRESHOLD_STATS,
  evaluateThresholds,
  formatThresholdResults,
  parseThresholds,
  thresholdsSchema,
} from './thresholds.ts';
export type {
  Threshold,
  ThresholdOperator,
  ThresholdResult,
  ThresholdStat,
  ThresholdsFile,
} from './thresholds.ts';
