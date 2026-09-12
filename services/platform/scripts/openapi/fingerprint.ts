import { createHash } from 'node:crypto';

import type { Json } from './spec.ts';

/**
 * What a client pins to when it pins `info.version`: the set of operations
 * (method, path, operationId) and the shape of every schema (property names
 * and which are required). `contract-fingerprint.json` records both hashes
 * beside the version they were generated with; `spec.test.ts` refuses a
 * document whose fingerprint moved while the version stayed, so the
 * version cannot go stale the way 1.3.0 did across nine added operations.
 * Descriptions and examples are deliberately outside the fingerprint — a
 * reworded sentence is not a contract change.
 */
export interface ContractFingerprint {
  operations: string;
  schemas: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function sha256(lines: string[]): string {
  return createHash('sha256').update(lines.sort().join('\n')).digest('hex');
}

export function contractFingerprint(spec: Json): ContractFingerprint {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, Json>>;
  const operations: string[] = [];
  for (const [path, byMethod] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = byMethod[method];
      if (op === undefined) continue;
      const operationId =
        typeof op.operationId === 'string' ? op.operationId : '';
      operations.push(`${method.toUpperCase()} ${path} ${operationId}`);
    }
  }
  const components = (spec.components ?? {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? {}) as Record<string, Json>;
  const shapes: string[] = [];
  for (const [name, schema] of Object.entries(schemas)) {
    const required = new Set(
      Array.isArray(schema.required) ? schema.required.map(String) : [],
    );
    const properties = Object.keys(
      (schema.properties ?? {}) as Record<string, unknown>,
    );
    if (properties.length === 0) {
      shapes.push(name);
      continue;
    }
    for (const property of properties) {
      shapes.push(
        `${name}.${property}${required.has(property) ? ':required' : ''}`,
      );
    }
  }
  return { operations: sha256(operations), schemas: sha256(shapes) };
}
