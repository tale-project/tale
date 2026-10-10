import { createHash } from 'node:crypto';

import { type McpToolListing, toolListing } from './listing';
import { MCP_PROMPTS } from './prompts';
import { MCP_RESOURCE_TEMPLATES, MCP_STATIC_RESOURCES } from './resources';
import {
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_MODERN_PROTOCOL_VERSIONS,
  MCP_SERVER_CAPABILITIES,
} from './server';
import { MCP_TOOLS } from './tools';

/**
 * The fingerprint of what an MCP client can depend on: the protocol
 * revisions of each era, the capabilities, every tool's name, input and output
 * schemas, annotations and client hints, every fixed resource's address and
 * type, every address template, and every prompt's name and arguments. `contract.test.ts` holds it to the
 * one recorded beside `API_CONTRACT_VERSION` (`contract-fingerprint.json`),
 * the way `scripts/openapi/spec.test.ts` holds the REST surface: a change
 * to it is a contract change, and the version — which `initialize` answers
 * as the server's — moves with it.
 *
 * Prose is outside it, as in the OpenAPI fingerprint: a reworded tool or
 * field description, a resource's or a prompt's title or description, the
 * server instructions, the references and the skill are not a contract
 * change.
 */

/** Keywords whose value is a map of schemas, a schema, or a list of them. */
const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
]);
const SCHEMA_VALUES = new Set([
  'items',
  'additionalProperties',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'additionalItems',
  'unevaluatedProperties',
  'unevaluatedItems',
]);
const SCHEMA_LISTS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON Schema without its prose: every `description` and `title` of a
 * schema node is dropped; a property that happens to be NAMED
 * `description` is kept. */
export function withoutProse(schema: unknown): unknown {
  if (!isPlainObject(schema)) return schema;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'description' || key === 'title') continue;
    if (SCHEMA_MAPS.has(key) && isPlainObject(value)) {
      kept[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, withoutProse(sub)]),
      );
    } else if (SCHEMA_VALUES.has(key)) {
      kept[key] = withoutProse(value);
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      kept[key] = value.map(withoutProse);
    } else {
      kept[key] = value;
    }
  }
  return kept;
}

/** JSON with every object's keys in one order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The fingerprint of an inventory as `tools/list` advertises it. */
export function mcpInventoryFingerprint(
  tools: readonly McpToolListing[] = MCP_TOOLS.map(toolListing),
): string {
  const contract = {
    protocolVersions: {
      modern: MCP_MODERN_PROTOCOL_VERSIONS,
      legacy: MCP_LEGACY_PROTOCOL_VERSIONS,
    },
    capabilities: MCP_SERVER_CAPABILITIES,
    tools: tools.map((tool) => ({
      name: tool.name,
      inputSchema: withoutProse(tool.inputSchema),
      outputSchema:
        tool.outputSchema === undefined
          ? null
          : withoutProse(tool.outputSchema),
      annotations: tool.annotations,
      meta: tool._meta ?? null,
    })),
    resources: MCP_STATIC_RESOURCES.map(({ uri, mimeType }) => ({
      uri,
      mimeType,
    })),
    resourceTemplates: MCP_RESOURCE_TEMPLATES.map(
      ({ uriTemplate, mimeType }) => ({ uriTemplate, mimeType }),
    ),
    prompts: MCP_PROMPTS.map((prompt) => ({
      name: prompt.name,
      arguments: prompt.arguments.map(({ name, required }) => ({
        name,
        required,
      })),
    })),
  };
  return createHash('sha256').update(canonical(contract)).digest('hex');
}
