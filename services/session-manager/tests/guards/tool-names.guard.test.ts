// The settings page documents the tools an assistant gets (`TOOL_GROUPS`, the
// README's table). The backend's catalog is the truth: a tool added, removed or
// renamed there must change the page in the same change, or this fails.

import { describe, expect, it } from 'vitest';

import { TOOL_GROUPS } from '../../app/features/settings/lib/tools.ts';
import { MCP_TOOLS, MCP_TOOL_NAMES } from '../../backend/domains/mcp/tools.ts';

describe('the tools the settings page lists', () => {
  const listed = TOOL_GROUPS.flatMap((group) => group.tools);

  it('are exactly the tools of the MCP server', () => {
    expect([...listed].sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  it('name no tool twice', () => {
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('are grouped as the catalog groups them', () => {
    for (const group of TOOL_GROUPS) {
      const inCatalog = MCP_TOOLS.filter(
        (tool) => tool.group === group.key,
      ).map((tool) => tool.name);
      expect([...group.tools].sort(), group.key).toEqual([...inCatalog].sort());
    }
    expect(TOOL_GROUPS.map((group) => group.key)).toEqual([
      ...new Set(MCP_TOOLS.map((tool) => tool.group)),
    ]);
  });
});
