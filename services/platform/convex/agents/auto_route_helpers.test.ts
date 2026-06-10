import { describe, expect, it } from 'vitest';

import {
  type AgentListEntry,
  buildRouterInstructions,
  filterRoutingCandidates,
  matchSlug,
  hashCandidates,
  mergeRouterTuning,
  normalizeMessageKey,
  parseRouterDecision,
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

  it('includes tool names and a JSON-output instruction', () => {
    const prompt = buildRouterInstructions([
      {
        name: 'billing-agent',
        description: 'Invoices',
        toolNames: ['create_invoice', 'issue_refund'],
        visibleInChat: true,
      },
    ]);
    expect(prompt).toContain('tools: create_invoice, issue_refund');
    expect(prompt).toContain('{"slug"');
  });

  it('adds few-shot examples from conversation starters', () => {
    const prompt = buildRouterInstructions([
      {
        name: 'researcher',
        description: 'Research',
        conversationStarters: ['Find recent papers on X'],
        visibleInChat: true,
      },
    ]);
    expect(prompt).toContain('Examples:');
    expect(prompt).toContain('Find recent papers on X');
    expect(prompt).toContain('{"slug":"researcher"}');
  });
});

describe('parseRouterDecision', () => {
  const cands: AgentListEntry[] = [
    { name: 'billing-agent', visibleInChat: true },
    { name: 'chat-agent', visibleInChat: true },
  ];

  it('parses a clean JSON slug object', () => {
    expect(parseRouterDecision('{"slug":"billing-agent"}', cands)).toEqual({
      slug: 'billing-agent',
    });
  });

  it('parses JSON embedded in surrounding prose', () => {
    expect(
      parseRouterDecision('Sure! {"slug": "chat-agent"} is best.', cands),
    ).toEqual({ slug: 'chat-agent' });
  });

  it('falls back to matchSlug for plain prose', () => {
    expect(parseRouterDecision('billing-agent', cands)).toEqual({
      slug: 'billing-agent',
    });
  });

  it('returns null for an out-of-set slug', () => {
    expect(parseRouterDecision('{"slug":"nonexistent"}', cands)).toBeNull();
  });

  it('returns null gracefully on malformed JSON (no throw)', () => {
    expect(parseRouterDecision('{"slug": billing-agent', cands)).toBeNull();
  });

  it('recovers the slug from a truncated decision object (clipped output)', () => {
    // The classifier reply was cut mid-JSON before the closing brace (e.g. the
    // model emitted a language hint that overran the token budget). The advisory
    // fields are lost, but the route must still reach the chosen assistant.
    expect(
      parseRouterDecision('{"slug":"billing-agent","language":"d', cands),
    ).toEqual({ slug: 'billing-agent' });
  });

  it('recovers the slug when the model answers with bare prose', () => {
    expect(parseRouterDecision('chat-agent', cands)).toEqual({
      slug: 'chat-agent',
    });
  });

  it('extracts a valid language hint and drops a sentence-like one', () => {
    expect(
      parseRouterDecision('{"slug":"chat-agent","language":"fr"}', cands)
        ?.language,
    ).toBe('fr');
    // A whole sentence in the language slot is rejected (length/charset guard).
    expect(
      parseRouterDecision(
        '{"slug":"chat-agent","language":"please answer in formal German!"}',
        cands,
      )?.language,
    ).toBeUndefined();
  });

  it('extracts only valid style/verbosity enum values into tuning', () => {
    expect(
      parseRouterDecision(
        '{"slug":"chat-agent","style":"concise","verbosity":"terse"}',
        cands,
      )?.tuning,
    ).toEqual({ style: 'concise', verbosity: 'terse' });
    // Unknown enum values are dropped; with none valid, tuning is omitted.
    expect(
      parseRouterDecision('{"slug":"chat-agent","style":"sarcastic"}', cands)
        ?.tuning,
    ).toBeUndefined();
  });

  it('reads a capabilities array and caps/sanitizes it', () => {
    expect(
      parseRouterDecision(
        '{"slug":"chat-agent","capabilities":["web"," "]}',
        cands,
      )?.capabilities,
    ).toEqual(['web']);
  });
});

describe('mergeRouterTuning', () => {
  it('fills only unset / adaptive fields; author values win', () => {
    expect(
      mergeRouterTuning(
        { style: 'formal', verbosity: 'adaptive' },
        { style: 'concise', verbosity: 'terse' },
      ),
    ).toEqual({ style: 'formal', verbosity: 'terse' });
  });

  it('returns the author config untouched when there is no advice', () => {
    const author = { style: 'concise' as const };
    expect(mergeRouterTuning(author, undefined)).toBe(author);
    expect(mergeRouterTuning(author, {})).toBe(author);
  });

  it('applies advice when the author config is absent', () => {
    expect(mergeRouterTuning(undefined, { style: 'detailed' })).toEqual({
      style: 'detailed',
    });
  });
});

describe('normalizeMessageKey', () => {
  it('lowercases, collapses whitespace, and trims', () => {
    expect(normalizeMessageKey('  Hello   World  ')).toBe('hello world');
    expect(normalizeMessageKey('REFUND my\tInvoice')).toBe('refund my invoice');
  });

  it('caps length at 256 chars', () => {
    expect(normalizeMessageKey('x'.repeat(500))).toHaveLength(256);
  });
});

describe('hashCandidates', () => {
  const a: AgentListEntry = { name: 'a', description: 'alpha' };
  const b: AgentListEntry = { name: 'b', description: 'beta' };

  it('is stable regardless of candidate order', () => {
    expect(hashCandidates([a, b])).toBe(hashCandidates([b, a]));
  });

  it('changes when the roster changes', () => {
    expect(hashCandidates([a, b])).not.toBe(hashCandidates([a]));
  });

  it('changes when a description changes', () => {
    expect(hashCandidates([a])).not.toBe(
      hashCandidates([{ name: 'a', description: 'alpha v2' }]),
    );
  });
});
