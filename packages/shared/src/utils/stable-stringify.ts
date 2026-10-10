/** Deep-equality serialization independent of key order: JSON with every
 * object's keys sorted. A value JSON cannot hold (`undefined`, a function)
 * serializes as `null`, wherever it sits. Pure — the automation engine and
 * the browser use it too. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
    const record = v as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}
