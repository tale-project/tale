const encoder = new TextEncoder();

/**
 * How many bytes `value` takes as UTF-8 JSON: what a door's size limit and
 * an answer's budget count. A value JSON cannot hold (`undefined`, a
 * function) takes none.
 */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? '').length;
}
