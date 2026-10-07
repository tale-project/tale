import { describe, expect, it } from 'vitest';

import { AGENT_TOOL_CATALOG } from '../agent-tool-grants';
import {
  managedAgentToolsSchema,
  managedPlatformResourceSchema,
} from './managed-configuration';
import { PROJECT_AGENT_BINDINGS_MAX } from './projects';

describe('managed agent tool declarations', () => {
  const identity = { projectId: 'project-a', agentId: 'agent-a' };

  it('canonicalizes duplicate grants in catalog order, including project-only tools', () => {
    const tools = AGENT_TOOL_CATALOG.map((tool) => tool.name);
    expect(
      managedPlatformResourceSchema.parse({
        kind: 'agent-tools',
        config: {
          ...identity,
          tools: [...tools].reverse().concat(tools.slice(0, 1)),
        },
      }),
    ).toEqual({ kind: 'agent-tools', config: { ...identity, tools } });
    expect(managedAgentToolsSchema.parse({ ...identity, tools: [] })).toEqual({
      ...identity,
      tools: [],
    });
  });

  it.each([
    { tools: ['task_review', 'unknown_tool'] },
    { tools: ['generate_image'] },
    { tools: [' task_review '] },
    { tools: Array(PROJECT_AGENT_BINDINGS_MAX + 1).fill('task_get') },
    { tools: null },
    { tools: [], secrets: ['PRIVATE_TOKEN'] },
    { tools: [], instructions: 'replace unrelated text' },
    { tools: [], model: 'replace-runtime' },
    { tools: [], expectedUpdatedAt: 1 },
  ])(
    'rejects unknown, excessive or unowned configuration fields: %j',
    (fields) => {
      expect(
        managedAgentToolsSchema.safeParse({ ...identity, ...fields }).success,
      ).toBe(false);
    },
  );

  it('requires both explicit identities and the complete desired grant set', () => {
    for (const config of [
      { tools: [] },
      { ...identity },
      { ...identity, agentId: '', tools: [] },
    ])
      expect(managedAgentToolsSchema.safeParse(config).success).toBe(false);
  });
});
