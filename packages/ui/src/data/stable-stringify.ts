/**
 * JSON text with object keys in sorted order (UTF-16 code units, as
 * JavaScript sorts strings), so two values that hold the same data serialize
 * alike whatever order their keys were written in. It follows
 * `JSON.stringify` otherwise: `undefined`, functions and symbols are left out
 * of objects and read as `null` in lists, `NaN` and the infinities read as
 * `null`, a bigint reads as its digits, and a value with `toJSON` is
 * serialized through it.
 */
export function stableStringify(value: unknown): string {
  return write(value) ?? 'null';
}

/** The value as plain JSON data: what a reader of its JSON text would get. */
export function jsonNormalize(value: unknown): unknown {
  const text = write(value);
  if (text === undefined) return undefined;
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function write(value: unknown): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'object': {
      if ('toJSON' in value && typeof value.toJSON === 'function') {
        const json: unknown = value.toJSON();
        return write(json);
      }
      if (Array.isArray(value)) {
        return `[${value.map((item: unknown) => write(item) ?? 'null').join(',')}]`;
      }
      const parts: string[] = [];
      for (const [key, entry] of Object.entries(value).toSorted(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const text = write(entry);
        if (text !== undefined) parts.push(`${JSON.stringify(key)}:${text}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      return undefined;
  }
}
