import { describe, expect, it } from 'vitest';

import {
  buildAgentSectionOptions,
  partitionAgentsByDisplayCategory,
  pruneEmptyAgentSections,
} from './agent-picker-options';

describe('agent-picker-options', () => {
  const agents = [
    { name: 'assistant', primaryBehavior: 'chat' },
    { name: 'claude-code', primaryBehavior: 'external-agent' },
    { name: 'image-gen', primaryBehavior: 'image-generation' },
  ] as const;

  it('partitions agents by display category', () => {
    const parts = partitionAgentsByDisplayCategory(agents);
    expect(parts.platform.map((a) => a.name)).toEqual(['assistant']);
    expect(parts.coding.map((a) => a.name)).toEqual(['claude-code']);
    expect(parts.image.map((a) => a.name)).toEqual(['image-gen']);
  });

  it('builds section headers before each category', () => {
    const options = buildAgentSectionOptions(
      agents,
      (agent) => ({ value: agent.name, label: agent.name }),
      {
        platform: 'Agents',
        coding: 'Coding agents',
        image: 'Image agents',
      },
    );
    expect(options.map((o) => o.label)).toEqual([
      'Agents',
      'assistant',
      'Coding agents',
      'claude-code',
      'Image agents',
      'image-gen',
    ]);
    expect(options[0]?.isSectionHeader).toBe(true);
    expect(options[2]?.isSectionHeader).toBe(true);
    expect(options[4]?.isSectionHeader).toBe(true);
  });

  it('drops section headers with no remaining rows', () => {
    const options = buildAgentSectionOptions(
      agents,
      (agent) => ({ value: agent.name, label: agent.name }),
      {
        platform: 'Agents',
        coding: 'Coding agents',
        image: 'Image agents',
      },
    );
    const pruned = pruneEmptyAgentSections(
      options.filter((opt) => opt.value !== 'assistant'),
    );
    expect(pruned.map((o) => o.label)).toEqual([
      'Coding agents',
      'claude-code',
      'Image agents',
      'image-gen',
    ]);
  });
});
