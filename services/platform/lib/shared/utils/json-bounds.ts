import { z } from 'zod';

/**
 * Bounds for a free-form JSON field a client stores whole — a contact's
 * `address` and `metadata`, a product's `metadata`, a document's
 * `metadata`: the fields the schemas type as `record<string, unknown>` and
 * therefore cap nowhere else. Without a bound a 5 MB blob and a
 * hundred-level nesting were stored with a 201 (the blob took 75 s to
 * land); with one, a value past the bound answers the documented 400
 * naming the path that broke it.
 *
 * Distinct from `bound-json.ts`, which TRUNCATES purely descriptive data
 * (a tool result, a run log): a value a client reads back is never
 * altered here, only refused.
 */
export interface JsonBounds {
  /** The most bytes the value may take serialised as JSON (UTF-8). */
  readonly maxBytes: number;
  /** How many levels of nesting the value may hold below itself: a
   * container at depth `maxDepth` may hold scalars, not another
   * container. */
  readonly maxDepth: number;
  /** The most object keys the value may hold in total, every nested
   * object counted. */
  readonly maxKeys: number;
}

/** The one bound every free-form object field on the REST door shares. */
export const FREE_FORM_JSON_BOUNDS: JsonBounds = {
  maxBytes: 65_536,
  maxDepth: 8,
  maxKeys: 500,
};

export interface JsonBoundsBreach {
  /** The path of the offending value inside the field, as segments — empty
   * when the field as a whole broke the bound. */
  readonly path: readonly string[];
  readonly message: string;
}

/**
 * The first bound `value` breaks, or null. Iterative (an explicit stack,
 * like the door's NUL walk), so a hostile nesting cannot exhaust the call
 * stack before it is refused. Depth and key count are checked on the walk;
 * the byte measure serialises the value and therefore runs only once those
 * two have passed — `JSON.parse` accepts a nesting `JSON.stringify` cannot
 * walk back, so the order is what keeps the measure safe.
 */
export function findJsonBoundsBreach(
  value: unknown,
  bounds: JsonBounds = FREE_FORM_JSON_BOUNDS,
): JsonBoundsBreach | null {
  const stack: { value: unknown; path: string[]; depth: number }[] = [
    { value, path: [], depth: 0 },
  ];
  let keys = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    const current = item.value;
    if (current === null || typeof current !== 'object') continue;
    if (item.depth > bounds.maxDepth) {
      return {
        path: item.path,
        message: `is nested deeper than ${bounds.maxDepth} levels`,
      };
    }
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: current[index],
          path: [...item.path, String(index)],
          depth: item.depth + 1,
        });
      }
      continue;
    }
    const entries = Object.entries(current);
    keys += entries.length;
    if (keys > bounds.maxKeys) {
      return {
        path: [],
        message: `holds more than ${bounds.maxKeys} keys in total`,
      };
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry === undefined) continue;
      stack.push({
        value: entry[1],
        path: [...item.path, entry[0]],
        depth: item.depth + 1,
      });
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > bounds.maxBytes) {
    return {
      path: [],
      message: `exceeds ${Math.round(bounds.maxBytes / 1024)} KiB of JSON (${bytes} bytes)`,
    };
  }
  return null;
}

/**
 * A `record<string, unknown>` body field under `bounds` — the one schema
 * every free-form object field on the door is declared with. A breach is a
 * schema issue at the offending path, so the 400 envelope names
 * `metadata.a.b.c` rather than the body as a whole.
 */
export function boundedJsonObject(bounds: JsonBounds = FREE_FORM_JSON_BOUNDS) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    const breach = findJsonBoundsBreach(value, bounds);
    if (breach === null) return;
    ctx.addIssue({
      code: 'custom',
      message: breach.message,
      path: [...breach.path],
    });
  });
}
