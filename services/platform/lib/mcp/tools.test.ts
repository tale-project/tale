import { describe, expect, test } from 'vitest';

import { MCP_TOOL_GROUPS, MCP_TOOLS, type McpToolGroup } from './tools';

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
