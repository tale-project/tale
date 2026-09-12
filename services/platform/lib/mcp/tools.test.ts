import { describe, expect, test } from 'vitest';

import {
  MCP_TOOL_GROUPS,
  MCP_TOOLS,
  type McpToolAnnotations,
  type McpToolGroup,
} from './tools';

/**
 * The inventory's grouping contract. The endpoint docs
 * (docs/en/develop/mcp-endpoint.md) and the API → MCP settings section present
 * the same three groups, so membership is pinned by name here: a tool that
 * moves group, ships unclassified, or appears in the inventory without a docs
 * decision fails loudly instead of silently drifting the settings page away
 * from the docs tables. Names are listed in the advertised (`tools/list`)
 * order.
 */

const byGroup = (group: McpToolGroup) =>
  MCP_TOOLS.filter((tool) => tool.group === group).map((tool) => tool.name);

describe('MCP tool grouping', () => {
  test('group membership matches the endpoint docs tables', () => {
    expect(byGroup('authoring')).toEqual([
      'get_docs',
      'get_catalog',
      'search_catalog',
      'validate_automation',
      'run_automation',
      'test_automation',
      'save_automation',
      'get_automation',
      'list_automations',
      'deploy_automation',
    ]);
    expect(byGroup('management')).toEqual([
      'set_trigger',
      'run_deployed',
      'start_run',
      'list_runs',
      'get_run',
      'cancel_run',
      'list_versions',
      'list_triggers',
      'delete_trigger',
    ]);
    expect(byGroup('capability')).toEqual([
      'search_capabilities',
      'invoke_capability',
      'get_knowledge',
    ]);
  });

  test('the three groups partition the whole inventory', () => {
    expect(MCP_TOOL_GROUPS.flatMap(byGroup)).toHaveLength(MCP_TOOLS.length);
  });

  test('the advertised order keeps each group contiguous, in display order', () => {
    const transitions = MCP_TOOLS.map((tool) => tool.group).filter(
      (group, index, all) => group !== all[index - 1],
    );
    expect(transitions).toEqual([...MCP_TOOL_GROUPS]);
  });
});

/**
 * The annotations a host keys its trust decisions on, pinned tool by tool:
 * a read is `readOnlyHint: true` and nothing else; every tool that writes,
 * deletes, executes live or spends says so. A tool cannot enter the
 * inventory without a row here.
 */
describe('MCP tool annotations', () => {
  const hints = (
    readOnlyHint: boolean,
    destructiveHint: boolean,
    idempotentHint: boolean,
    openWorldHint: boolean,
  ): McpToolAnnotations => ({
    readOnlyHint,
    destructiveHint,
    idempotentHint,
    openWorldHint,
  });
  const READ = hints(true, false, false, false);
  const EXPECTED: Record<string, McpToolAnnotations> = {
    get_docs: { ...READ, idempotentHint: true },
    get_catalog: { ...READ, idempotentHint: true },
    search_catalog: { ...READ, idempotentHint: true },
    validate_automation: { ...READ, idempotentHint: true },
    run_automation: hints(false, false, true, false),
    test_automation: hints(false, false, true, false),
    save_automation: hints(false, false, false, false),
    get_automation: { ...READ, idempotentHint: true },
    list_automations: { ...READ, idempotentHint: true },
    deploy_automation: hints(false, true, true, false),
    set_trigger: hints(false, true, true, false),
    run_deployed: hints(false, true, false, true),
    start_run: hints(false, true, false, true),
    list_runs: { ...READ, idempotentHint: true },
    get_run: { ...READ, idempotentHint: true },
    cancel_run: hints(false, true, true, false),
    list_versions: { ...READ, idempotentHint: true },
    list_triggers: { ...READ, idempotentHint: true },
    delete_trigger: hints(false, true, true, false),
    search_capabilities: { ...READ, idempotentHint: true },
    invoke_capability: hints(false, true, false, true),
    get_knowledge: { ...READ, idempotentHint: true },
  };

  test('every tool carries all four hints, exactly as pinned', () => {
    const actual = Object.fromEntries(
      MCP_TOOLS.map((tool) => [tool.name, tool.annotations]),
    );
    expect(actual).toEqual(EXPECTED);
    for (const tool of MCP_TOOLS) {
      expect(Object.keys(tool.annotations).sort(), tool.name).toEqual([
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
        'readOnlyHint',
      ]);
    }
  });

  test('read-only is exactly the complement of the tools that write, execute or spend', () => {
    const mutating = new Set([
      'save_automation',
      'deploy_automation',
      'set_trigger',
      'delete_trigger',
      'cancel_run',
      'run_deployed',
      'start_run',
      'invoke_capability',
      'run_automation',
      'test_automation',
    ]);
    for (const tool of MCP_TOOLS) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(
        !mutating.has(tool.name),
      );
    }
  });
});
