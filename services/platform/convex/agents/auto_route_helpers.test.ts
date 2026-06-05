import { describe, expect, it } from 'vitest';

import {
  type AgentListEntry,
  buildRouterInstructions,
  filterRoutingCandidates,
  matchSlug,
  pickDefault,
} from './auto_route_helpers';

const agents: AgentListEntry[] = [
  { name: 'chat-agent', description: 'General assistant', visibleInChat: true },
  {
    name: 'crm-assistant',
    description: 'Customer + product data',
    visibleInChat: true,
  },
  { name: 'researcher', description: 'Web research', visibleInChat: true },
];

describe('filterRoutingCandidates', () => {
  it('keeps only chat-visible, non-image agents', () => {
    const raw: AgentListEntry[] = [
      ...agents,
      { name: 'hidden', visibleInChat: false },
      {
        name: 'imager',
        visibleInChat: true,
        primaryBehavior: 'image-generation',
      },
    ];
    const result = filterRoutingCandidates(raw).map((a) => a.name);
    expect(result).toEqual(['chat-agent', 'crm-assistant', 'researcher']);
  });

  it('honors the project allow-list when provided', () => {
    const result = filterRoutingCandidates(agents, [
      'researcher',
      'crm-assistant',
    ]).map((a) => a.name);
    expect(result.sort()).toEqual(['crm-assistant', 'researcher']);
  });

  it('ignores an empty allow-list (treats as no restriction)', () => {
    expect(filterRoutingCandidates(agents, [])).toHaveLength(3);
  });
});

describe('pickDefault', () => {
  it('prefers chat-agent when present', () => {
    expect(pickDefault(agents)?.name).toBe('chat-agent');
  });

  it('falls back to the first candidate when chat-agent is absent', () => {
    const without = agents.filter((a) => a.name !== 'chat-agent');
    expect(pickDefault(without)?.name).toBe('crm-assistant');
  });

  it('returns null when there are no candidates', () => {
    expect(pickDefault([])).toBeNull();
  });
});

describe('matchSlug', () => {
  it('matches an exact slug', () => {
    expect(matchSlug('researcher', agents)).toBe('researcher');
  });

  it('strips a leading list dash', () => {
    expect(matchSlug('- crm-assistant', agents)).toBe('crm-assistant');
  });

  it('strips surrounding quotes', () => {
    expect(matchSlug('"researcher"', agents)).toBe('researcher');
  });

  it('takes the slug when the model echoes "slug: description"', () => {
    expect(matchSlug('crm-assistant: handles customers', agents)).toBe(
      'crm-assistant',
    );
  });

  it('matches case-insensitively', () => {
    expect(matchSlug('Researcher', agents)).toBe('researcher');
  });

  it('returns null for an unknown slug', () => {
    expect(matchSlug('totally-made-up', agents)).toBeNull();
  });

  it('returns null for empty / whitespace output', () => {
    expect(matchSlug('   ', agents)).toBeNull();
    expect(matchSlug('', agents)).toBeNull();
  });
});

describe('buildRouterInstructions', () => {
  it('lists every candidate as "slug: description"', () => {
    const prompt = buildRouterInstructions(agents);
    expect(prompt).toContain('- chat-agent: General assistant');
    expect(prompt).toContain('- crm-assistant: Customer + product data');
    expect(prompt).toContain('- researcher: Web research');
  });

  it('substitutes a placeholder description when one is missing', () => {
    const prompt = buildRouterInstructions([
      { name: 'bare', visibleInChat: true },
    ]);
    expect(prompt).toContain('- bare: General-purpose assistant.');
  });
});
