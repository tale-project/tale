import { z } from 'zod';

/**
 * A tool schema as `tools/list` advertises it: the zod schema in JSON Schema
 * (2020-12, the default dialect since MCP 2025-11-25), without the `$schema`
 * marker. Older clients validate with a draft-07 validator that refuses an
 * unknown `$schema` outright, and a schema that names no dialect is read in
 * the protocol's default one by the newer clients.
 *
 * Generated once per schema and cached: the inventory never changes at run
 * time, and `tools/list` answers it on every connection.
 */
const generated = {
  input: new WeakMap<z.ZodType, Record<string, unknown>>(),
  output: new WeakMap<z.ZodType, Record<string, unknown>>(),
};

export function toolJsonSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
): Record<string, unknown> {
  const cached = generated[io].get(schema);
  if (cached !== undefined) return cached;
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
  });
  generated[io].set(schema, json);
  return json;
}
