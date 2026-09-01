/**
 * Minimal, dependency-free JSONPath reader shared by config-driven response
 * mappers (governance moderation providers, token sources). Supports only the
 * simple `$.a.b[0].c` subset — object keys and numeric array indexes. Anything
 * more exotic should validate against a richer expression engine instead.
 *
 * Pure (no `node:*`, no Convex) so it is import-safe from V8 queries,
 * `'use node'` actions, and the platform server alike.
 */

import { isRecord } from '../../../../lib/utils/type-utils';

export class JsonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonPathError';
  }
}

/**
 * Read `jsonPath` (e.g. `$.tokens[0].access_token`) out of `root`, returning
 * `undefined` if any segment is missing. Throws `JsonPathError` only when the
 * path itself is malformed (does not start with `$`).
 */
export function readJsonPath(root: unknown, jsonPath: string): unknown {
  if (!jsonPath.startsWith('$')) {
    throw new JsonPathError(`JSONPath must start with $: ${jsonPath}`);
  }
  const tokens = jsonPath
    .slice(1)
    .split(/\.|\[(\d+)\]/)
    .filter((t) => t !== undefined && t !== '');

  let current: unknown = root;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    const maybeIndex = Number(token);
    if (!Number.isNaN(maybeIndex) && Array.isArray(current)) {
      current = current[maybeIndex];
      continue;
    }
    if (isRecord(current)) {
      current = current[token];
      continue;
    }
    return undefined;
  }
  return current;
}
