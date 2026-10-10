// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MCP_TOOL_GROUPS, MCP_TOOLS, type McpToolGroup } from './tools';

/**
 * The MCP endpoint page (`docs/{en,de,fr}/develop/mcp-endpoint.md`) tables
 * every tool under its group, the way `tools/list` and Settings › API › MCP
 * present them. The tables are written by hand, so a tool that ships, moves
 * group or leaves the inventory without its row fails here instead of the
 * page teaching an inventory the endpoint no longer serves. Each group's
 * heading carries the same explicit id in every locale, and its first table
 * names one tool per row in the first column. The pages are outside this
 * workspace: `services/platform/turbo.json` hashes them for this suite.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const LOCALES = ['en', 'de', 'fr'] as const;

/** The heading id of each group's section — exhaustive, so a new group
 * cannot ship without its section on the page. */
const GROUP_ANCHORS: Record<McpToolGroup, string> = {
  authoring: 'authoring',
  management: 'management',
  discovery: 'discovery',
  settings: 'settings',
  capability: 'capabilities',
};

/** The tools the first table under the heading `{#anchor}` names, in page
 * order: the first backticked name of each row after the header. */
function tabledTools(page: string, anchor: string): string[] {
  const lines = page.split('\n');
  const heading = lines.findIndex((line) =>
    new RegExp(`^#{2,4} .*\\{#${anchor}\\}\\s*$`).test(line),
  );
  expect(heading, `no heading {#${anchor}}`).toBeGreaterThanOrEqual(0);
  const start = lines.findIndex(
    (line, index) => index > heading && line.startsWith('|'),
  );
  const nextHeading = lines.findIndex(
    (line, index) => index > heading && /^#{1,6} /.test(line),
  );
  expect(start, `no table under {#${anchor}}`).toBeGreaterThan(heading);
  if (nextHeading !== -1) expect(start).toBeLessThan(nextHeading);
  const rows: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break;
    rows.push(line);
  }
  // The header row and its delimiter row name no tool.
  return rows.slice(2).map((row) => {
    const firstCell = row.split('|')[1] ?? '';
    return /`([a-z_]+)`/.exec(firstCell)?.[1] ?? firstCell.trim();
  });
}

describe('the MCP endpoint page tables every tool under its group', () => {
  for (const locale of LOCALES) {
    describe(`docs/${locale}/develop/mcp-endpoint.md`, () => {
      const page = readFileSync(
        path.join(REPO_ROOT, 'docs', locale, 'develop/mcp-endpoint.md'),
        'utf8',
      );

      it.each(MCP_TOOL_GROUPS.map((group) => [group] as const))(
        'the %s table names exactly the tools of that group',
        (group) => {
          const tabled = tabledTools(page, GROUP_ANCHORS[group]);
          expect(new Set(tabled).size, 'a tool is tabled twice').toBe(
            tabled.length,
          );
          expect([...tabled].sort()).toEqual(
            MCP_TOOLS.filter((tool) => tool.group === group)
              .map((tool) => tool.name)
              .sort(),
          );
        },
      );
    });
  }
});
