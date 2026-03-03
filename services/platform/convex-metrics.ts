/**
 * Convex metrics proxy with vmhistogram → Prometheus histogram conversion.
 *
 * Convex's local backend exposes metrics using VictoriaMetrics' vmhistogram
 * format (vmrange buckets, non-cumulative counts). Grafana Cloud and standard
 * Prometheus scrapers don't understand vmhistogram, so this module fetches the
 * raw metrics, converts vmhistogram → standard histogram (le buckets,
 * cumulative counts), and passes counter/gauge metrics through unchanged.
 */

const CONVEX_PORT = process.env.CONVEX_PORT || '3210';
const CONVEX_METRICS_URL = `http://localhost:${CONVEX_PORT}/metrics`;
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
const PLAIN_CONTENT_TYPE = 'text/plain; charset=utf-8';

interface Bucket {
  le: number;
  count: number;
}

/**
 * Parse a vmrange string like "1.000e-3...1.136e-3" and return the upper bound.
 */
function parseVmrangeUpperBound(vmrange: string): number {
  const dotIdx = vmrange.indexOf('...');
  const upper = vmrange.slice(dotIdx + 3);
  if (upper === '+Inf' || upper === 'Inf') return Infinity;
  return parseFloat(upper);
}

/**
 * Convert raw Convex metrics text from vmhistogram format to standard
 * Prometheus histogram format. Counter and gauge metrics pass through unchanged.
 *
 * Assumes Convex backend emits metrics in grouped format: all _bucket lines
 * for a label set, then _sum, then _count. Interleaved label groups across
 * non-adjacent lines are not supported.
 */
export function convertVmhistogramToPrometheus(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const output: string[] = [];

  // Track state for the current vmhistogram metric group
  let inVmhistogram = false;
  let currentBaseName = '';
  // Map from label signature (without vmrange) → sorted bucket list
  let bucketGroups = new Map<string, Bucket[]>();
  // Buffer _sum lines so buckets are emitted before them (Prometheus convention)
  let pendingLines: string[] = [];

  for (const line of lines) {
    // # TYPE line — detect vmhistogram and rewrite to histogram
    if (line.startsWith('# TYPE ')) {
      flushBuckets(output, currentBaseName, bucketGroups);
      for (const p of pendingLines) output.push(p);
      pendingLines = [];
      const spaceIdx = line.indexOf(' ', 7);
      const metricName = line.slice(7, spaceIdx);
      const metricType = line.slice(spaceIdx + 1);

      if (metricType === 'vmhistogram') {
        inVmhistogram = true;
        currentBaseName = metricName;
        bucketGroups = new Map();
        output.push(`# TYPE ${metricName} histogram`);
      } else {
        inVmhistogram = false;
        output.push(line);
      }
      continue;
    }

    // Comment / HELP lines — pass through
    if (line.startsWith('#') || line === '') {
      output.push(line);
      continue;
    }

    // Non-vmhistogram data lines — pass through
    if (!inVmhistogram) {
      output.push(line);
      continue;
    }

    // vmhistogram bucket line: metric_bucket{...,vmrange="start...end"} value
    const vmrangeIdx = line.indexOf('vmrange="');
    if (vmrangeIdx !== -1) {
      // Find the vmrange value boundaries
      const rangeStart = vmrangeIdx + 9; // after vmrange="
      const rangeEnd = line.indexOf('"', rangeStart);
      const vmrange = line.slice(rangeStart, rangeEnd);

      // In valid Prometheus lines, the last } is always the label-block closer
      // (the value portion after } is always numeric, never contains braces)
      const braceEnd = line.lastIndexOf('}');
      if (braceEnd === -1) continue;
      const count = parseFloat(line.slice(braceEnd + 2));

      // Build the label key without vmrange for grouping
      // Remove the vmrange="..." portion and any surrounding comma
      let labelKey: string;
      const beforeVmrange = line.slice(0, vmrangeIdx);
      const afterVmrange = line.slice(rangeEnd + 1, braceEnd);

      if (beforeVmrange.endsWith(',')) {
        // vmrange is NOT the first label: metric{a="b",vmrange="..."}
        labelKey = beforeVmrange.slice(0, -1) + afterVmrange;
      } else if (afterVmrange.startsWith(',')) {
        // vmrange IS the first label: metric{vmrange="...",a="b"}
        labelKey = beforeVmrange + afterVmrange.slice(1);
      } else {
        // vmrange is the only label: metric{vmrange="..."}
        labelKey = beforeVmrange + afterVmrange;
      }

      const le = parseVmrangeUpperBound(vmrange);
      let group = bucketGroups.get(labelKey);
      if (!group) {
        group = [];
        bucketGroups.set(labelKey, group);
      }
      group.push({ le, count });
      continue;
    }

    // _count line — flush matching buckets first (Prometheus: buckets → _sum → _count)
    if (isCountSuffix(line)) {
      flushBucketsForCount(output, bucketGroups, line);
      for (const p of pendingLines) output.push(p);
      pendingLines = [];
      output.push(line);
      continue;
    }

    // _sum and other vmhistogram data lines — buffer for correct ordering
    pendingLines.push(line);
  }

  // Flush any remaining buckets at end of input
  flushBuckets(output, currentBaseName, bucketGroups);
  for (const p of pendingLines) output.push(p);

  return output.join('\n');
}

/**
 * Check if a metric line has `_count` as its metric name suffix.
 */
function isCountSuffix(line: string): boolean {
  const braceIdx = line.indexOf('{');
  const spaceIdx = line.indexOf(' ');
  if (spaceIdx === -1) return false;
  const nameEnd = braceIdx !== -1 && braceIdx < spaceIdx ? braceIdx : spaceIdx;
  return line.slice(0, nameEnd).endsWith('_count');
}

/**
 * Emit cumulative le-based buckets + the +Inf bucket for a single label group.
 */
function emitCumulativeBuckets(
  output: string[],
  bucketMetricName: string,
  labels: string,
  buckets: Bucket[],
  infCount: number,
): void {
  buckets.sort((a, b) => a.le - b.le);

  let cumulative = 0;
  for (const bucket of buckets) {
    if (bucket.le === Infinity) continue;
    cumulative += bucket.count;
    const leLabel = labels
      ? `${labels},le="${bucket.le}"`
      : `le="${bucket.le}"`;
    output.push(`${bucketMetricName}{${leLabel}} ${cumulative}`);
  }

  const infLabel = labels ? `${labels},le="+Inf"` : `le="+Inf"`;
  output.push(`${bucketMetricName}{${infLabel}} ${infCount}`);
}

/**
 * When we encounter a _count line, flush the corresponding bucket group.
 */
function flushBucketsForCount(
  output: string[],
  bucketGroups: Map<string, Bucket[]>,
  countLine: string,
): void {
  // In valid Prometheus lines, the last } is always the label-block closer
  const braceClose = countLine.lastIndexOf('}');
  const valueStart =
    braceClose !== -1
      ? countLine.indexOf(' ', braceClose)
      : countLine.indexOf(' ');
  const totalCount = parseFloat(countLine.slice(valueStart + 1));

  // Extract labels from the _count line
  const braceOpen = countLine.indexOf('{');

  // Determine the bucket metric name (replace _count with _bucket)
  const metricEnd = braceOpen !== -1 ? braceOpen : valueStart;
  const countMetricName = countLine.slice(0, metricEnd);
  const bucketMetricName = countMetricName.replace(/_count$/, '_bucket');

  const labels =
    braceOpen !== -1 ? countLine.slice(braceOpen + 1, braceClose) : '';

  // Find matching bucket group
  // The key format is: "metricname_bucket{labels" (without closing brace)
  let matched = false;
  for (const [groupKey, buckets] of bucketGroups) {
    const groupBraceOpen = groupKey.indexOf('{');
    const groupLabels =
      groupBraceOpen !== -1 ? groupKey.slice(groupBraceOpen + 1) : '';

    if (groupLabels === labels && groupKey.startsWith(bucketMetricName)) {
      emitCumulativeBuckets(
        output,
        bucketMetricName,
        labels,
        buckets,
        totalCount,
      );
      bucketGroups.delete(groupKey);
      matched = true;
      break;
    }
  }

  // No bucket lines existed — still emit the mandatory +Inf bucket
  if (!matched) {
    const infLabel = labels ? `${labels},le="+Inf"` : `le="+Inf"`;
    output.push(`${bucketMetricName}{${infLabel}} ${totalCount}`);
  }
}

/**
 * Flush all remaining bucket groups (safety net for malformed input).
 */
function flushBuckets(
  output: string[],
  baseName: string,
  bucketGroups: Map<string, Bucket[]>,
): void {
  if (bucketGroups.size === 0) return;

  const bucketMetricName = baseName.endsWith('_bucket')
    ? baseName
    : `${baseName}_bucket`;

  for (const [groupKey, buckets] of bucketGroups) {
    const braceOpen = groupKey.indexOf('{');
    const labels = braceOpen !== -1 ? groupKey.slice(braceOpen + 1) : '';

    // No _count available — use sum of bucket counts as best approximation
    let total = 0;
    for (const b of buckets) total += b.count;

    emitCumulativeBuckets(output, bucketMetricName, labels, buckets, total);
  }

  bucketGroups.clear();
}

/**
 * Fetch Convex metrics, convert vmhistogram → Prometheus histogram,
 * and return as an HTTP Response.
 */
export async function convexMetricsResponse(
  format?: string | null,
  convert: (text: string) => string = convertVmhistogramToPrometheus,
): Promise<Response> {
  try {
    const res = await fetch(CONVEX_METRICS_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`Convex metrics upstream returned ${res.status}`);
      return new Response('Convex metrics unavailable', { status: 502 });
    }
    const raw = await res.text();
    let body: string;
    try {
      body = format === 'raw' ? raw : convert(raw);
    } catch (err) {
      console.error('Convex metrics conversion failed:', err);
      return new Response('Convex metrics conversion failed', { status: 500 });
    }
    const contentType =
      format === 'raw' ? PLAIN_CONTENT_TYPE : PROMETHEUS_CONTENT_TYPE;
    return new Response(body, {
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    console.error('Failed to fetch Convex metrics:', error);
    return new Response('Convex metrics unavailable', { status: 502 });
  }
}
