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
  const inlined = inlineDefinitions(json);
  generated[io].set(schema, inlined);
  return inlined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The schema with its `$defs` written in place: every `$ref` into them is
 * replaced by the definition itself, so a client that does not resolve
 * references still reads the whole shape. A definition that refers to
 * itself (an "any JSON value") stops at `{}` — any value — one level down;
 * the tool's own arguments check what a call sends.
 */
function inlineDefinitions(
  json: Record<string, unknown>,
): Record<string, unknown> {
  const { $defs: definitions, ...rest } = json;
  if (!isRecord(definitions)) return json;
  const resolve = (node: unknown, open: ReadonlySet<string>): unknown => {
    if (Array.isArray(node)) return node.map((item) => resolve(item, open));
    if (!isRecord(node)) return node;
    const { $ref: ref, ...siblings } = node;
    const resolvedSiblings = Object.fromEntries(
      Object.entries(siblings).map(([key, value]) => [
        key,
        resolve(value, open),
      ]),
    );
    if (typeof ref !== 'string' || !ref.startsWith('#/$defs/')) {
      return ref === undefined
        ? resolvedSiblings
        : { $ref: ref, ...resolvedSiblings };
    }
    const name = ref.slice('#/$defs/'.length);
    const definition = definitions[name];
    if (open.has(name) || !isRecord(definition)) return resolvedSiblings;
    const inlined = resolve(definition, new Set([...open, name]));
    return { ...(isRecord(inlined) ? inlined : {}), ...resolvedSiblings };
  };
  const inlined = resolve(rest, new Set());
  return isRecord(inlined) ? inlined : rest;
}
