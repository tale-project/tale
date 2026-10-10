import { toolJsonSchema } from './json-schema';
import type { McpToolSpec } from './tools';

/** One tool as `tools/list` advertises it. */
export interface McpToolListing {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations: McpToolSpec['annotations'];
  readonly _meta?: Record<string, unknown>;
}

/** The client hints a tool carries in `_meta`, when it carries any: ask the
 * person before every call (going live), and keep a large answer inline. */
function toolMeta(tool: McpToolSpec): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {
    ...(tool.requiresUserInteraction
      ? { 'anthropic/requiresUserInteraction': true }
      : {}),
    ...(tool.maxResultChars === undefined
      ? {}
      : { 'anthropic/maxResultSizeChars': tool.maxResultChars }),
  };
  return Object.keys(meta).length === 0 ? undefined : meta;
}

/** One tool as `tools/list` advertises it. */
export function toolListing(tool: McpToolSpec): McpToolListing {
  const meta = toolMeta(tool);
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toolJsonSchema(tool.args, 'input'),
    ...(tool.result === null
      ? {}
      : { outputSchema: toolJsonSchema(tool.result, 'output') }),
    annotations: tool.annotations,
    ...(meta === undefined ? {} : { _meta: meta }),
  };
}
