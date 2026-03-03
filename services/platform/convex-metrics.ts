/**
 * Convex metrics proxy with vmhistogram → Prometheus histogram conversion.
 *
 * Convex's local backend exposes metrics using VictoriaMetrics' vmhistogram
 * format (vmrange buckets, non-cumulative counts). Grafana Cloud and standard
 * Prometheus scrapers don't understand vmhistogram, so this module fetches the
 * raw metrics, converts vmhistogram → standard histogram (le buckets,
 * cumulative counts), and passes counter/gauge metrics through unchanged.
 */

const CONVEX_METRICS_URL = 'http://localhost:3210/metrics';
const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

interface Bucket {
  le: number;
  count: number;
}

/**
 * Parse a vmrange string like "1.000e-3...1.136e-3" and return the upper bound.
 */
function parseVmrangeUpperBound(vmrange: string): number {
  const dotIdx = vmrange.indexOf('...');
  return parseFloat(vmrange.slice(dotIdx + 3));
}

/**
 * Convert raw Convex metrics text from vmhistogram format to standard
 * Prometheus histogram format. Counter and gauge metrics pass through unchanged.
 */
export function convertVmhistogramToPrometheus(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];

  // Track state for the current vmhistogram metric group
  let inVmhistogram = false;
  let currentBaseName = '';
  // Map from label signature (without vmrange) → sorted bucket list
  let bucketGroups = new Map<string, Bucket[]>();

  for (const line of lines) {
    // # TYPE line — detect vmhistogram and rewrite to histogram
    if (line.startsWith('# TYPE ')) {
      flushBuckets(output, currentBaseName, bucketGroups);
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

      // Extract the value after the closing brace
      const braceEnd = line.indexOf('}', rangeEnd);
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

    // _sum and _count lines — pass through, and flush buckets on _count
    output.push(line);

    if (line.includes('_count{') || line.includes('_count ')) {
      flushBucketsForCount(output, currentBaseName, bucketGroups, line);
    }
  }

  // Flush any remaining buckets at end of input
  flushBuckets(output, currentBaseName, bucketGroups);

  return output.join('\n');
}

/**
 * When we encounter a _count line, flush the corresponding bucket group
 * and emit cumulative le-based buckets + the +Inf bucket.
 */
function flushBucketsForCount(
  output: string[],
  baseName: string,
  bucketGroups: Map<string, Bucket[]>,
  countLine: string,
): void {
  // Extract total count value
  const spaceIdx = countLine.lastIndexOf(' ');
  const totalCount = parseFloat(countLine.slice(spaceIdx + 1));

  // Extract labels from the _count line
  const braceOpen = countLine.indexOf('{');
  const braceClose = countLine.indexOf('}');

  // Determine the bucket metric name (replace _count with _bucket)
  const metricEnd =
    countLine.indexOf('{') !== -1
      ? countLine.indexOf('{')
      : countLine.indexOf(' ');
  const countMetricName = countLine.slice(0, metricEnd);
  const bucketMetricName = countMetricName.replace('_count', '_bucket');

  const labels =
    braceOpen !== -1 ? countLine.slice(braceOpen + 1, braceClose) : '';

  // Find matching bucket group
  // The key format is: "metricname_bucket{labels" (without closing brace)
  for (const [groupKey, buckets] of bucketGroups) {
    // Check if this group matches the current _count line's labels
    const groupBraceOpen = groupKey.indexOf('{');
    const groupLabels =
      groupBraceOpen !== -1 ? groupKey.slice(groupBraceOpen + 1) : '';

    if (groupLabels === labels && groupKey.startsWith(bucketMetricName)) {
      // Sort by le ascending
      buckets.sort((a, b) => a.le - b.le);

      // Convert to cumulative counts
      let cumulative = 0;
      for (const bucket of buckets) {
        cumulative += bucket.count;
        const leLabel = labels
          ? `${labels},le="${bucket.le}"`
          : `le="${bucket.le}"`;
        output.push(`${bucketMetricName}{${leLabel}} ${cumulative}`);
      }

      // Add +Inf bucket
      const infLabel = labels ? `${labels},le="+Inf"` : `le="+Inf"`;
      output.push(`${bucketMetricName}{${infLabel}} ${totalCount}`);

      bucketGroups.delete(groupKey);
      break;
    }
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
    buckets.sort((a, b) => a.le - b.le);
    const braceOpen = groupKey.indexOf('{');
    const labels = braceOpen !== -1 ? groupKey.slice(braceOpen + 1) : '';

    let cumulative = 0;
    for (const bucket of buckets) {
      cumulative += bucket.count;
      const leLabel = labels
        ? `${labels},le="${bucket.le}"`
        : `le="${bucket.le}"`;
      output.push(`${bucketMetricName}{${leLabel}} ${cumulative}`);
    }

    const infLabel = labels ? `${labels},le="+Inf"` : `le="+Inf"`;
    output.push(`${bucketMetricName}{${infLabel}} ${cumulative}`);
  }

  bucketGroups.clear();
}

/**
 * Fetch Convex metrics, convert vmhistogram → Prometheus histogram,
 * and return as an HTTP Response.
 */
export async function convexMetricsResponse(): Promise<Response> {
  try {
    const res = await fetch(CONVEX_METRICS_URL);
    if (!res.ok) {
      return new Response(`Convex metrics unavailable: ${res.status}`, {
        status: 502,
      });
    }
    const raw = await res.text();
    const converted = convertVmhistogramToPrometheus(raw);
    return new Response(converted, {
      headers: { 'Content-Type': CONTENT_TYPE },
    });
  } catch {
    return new Response('Convex metrics unavailable', { status: 502 });
  }
}
