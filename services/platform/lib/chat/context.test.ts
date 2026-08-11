import { describe, expect, it } from 'vitest';

import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../../convex/lib/untrusted_content';
import {
  assembleContext,
  CONTEXT_BLOCK_ORDER,
  resolveAgentInstructions,
  truncationNotice,
  type ContextInput,
} from './context';
import type { ChatMessage } from './types';
import { estimateMessageTokens, estimateTokens } from './types';

/**
 * The context contract is an ORDER, so these tests assert the order itself —
 * not just that the pieces are present. The cache breakpoint's position is the
 * load-bearing part: everything above it is identical turn after turn, which
 * is the only reason a provider can serve it from cache.
 */

const NOW = new Date('2026-07-22T09:00:00.000Z');

function message(role: ChatMessage['role'], text: string): ChatMessage {
  return { role, parts: [{ type: 'text', text }] };
}

function input(overrides: Partial<ContextInput> = {}): ContextInput {
  return {
    organizationId: 'org_1',
    mandatoryInstructions: 'Never promise a delivery date.',
    agent: {
      slug: 'assistant',
      instructions: 'You help with support tickets.',
    },
    locale: 'de',
    toolDocs: [
      { id: 'builtin.run_code', description: 'Run code in a sandbox.' },
    ],
    now: NOW,
    history: [message('user', 'hello')],
    budget: { maxTokens: 10_000 },
    ...overrides,
  };
}

describe('assembleContext', () => {
  it('emits the blocks in exactly the contracted order', () => {
    const result = assembleContext(input());

    expect(result.blocks.map((block) => block.id)).toEqual([
      ...CONTEXT_BLOCK_ORDER,
    ]);
  });

  it('puts the cache breakpoint after the tool docs and before the clock', () => {
    const result = assembleContext(input());

    expect(result.cacheBreakpointIndex).toBe(4);
    expect(result.blocks[result.cacheBreakpointIndex]).toEqual({
      id: 'cache-breakpoint',
    });

    // Stable prefix: org rules, agent instructions, trust rules, tool docs.
    expect(result.stablePrefix).toContain('Never promise a delivery date.');
    expect(result.stablePrefix).toContain('You help with support tickets.');
    expect(result.stablePrefix).toContain(UNTRUSTED_CONTENT_SYSTEM_PROMPT);
    expect(result.stablePrefix).toContain('builtin.run_code');
    // Nothing that changes per turn may sit above the breakpoint.
    expect(result.stablePrefix).not.toContain('2026-07-22');
    expect(result.stablePrefix).not.toContain('hello');

    expect(result.volatileSuffix).toContain('2026-07-22T09:00:00.000Z');
    expect(result.volatileSuffix).toContain('(de)');
    expect(result.system).toBe(
      `${result.stablePrefix}\n\n${result.volatileSuffix}`,
    );
  });

  it('is deterministic — same input, same prompt', () => {
    expect(assembleContext(input()).system).toBe(
      assembleContext(input()).system,
    );
  });

  it('skips the org mandatory instructions on a sub-agent turn and keeps the rest in order', () => {
    const result = assembleContext(input({ isSubAgentTurn: true }));

    expect(result.blocks.map((block) => block.id)).toEqual([
      'agent-instructions',
      'untrusted-content-rules',
      'tool-docs',
      'cache-breakpoint',
      'runtime-directives',
      'message-history',
    ]);
    expect(result.system).not.toContain('Never promise a delivery date.');
  });

  it('omits blocks the turn has nothing for, without reordering the rest', () => {
    const result = assembleContext(
      input({
        mandatoryInstructions: undefined,
        agent: undefined,
        toolDocs: [],
      }),
    );

    expect(result.blocks.map((block) => block.id)).toEqual([
      'untrusted-content-rules',
      'cache-breakpoint',
      'runtime-directives',
      'message-history',
    ]);
  });

  it('carries the whole history, tool messages and cards included', () => {
    const history: ChatMessage[] = [
      message('user', 'open a ticket'),
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            callId: 'c1',
            capabilityId: 'connector.zendesk.create_ticket',
            input: { subject: 'printer' },
          },
        ],
      },
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            callId: 'c1',
            capabilityId: 'connector.zendesk.create_ticket',
            output: { id: 42 },
            structured: true,
          },
        ],
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'approval',
            approvalId: 'a1',
            question: 'Send the confirmation email?',
          },
          {
            type: 'human-input',
            requestId: 'h1',
            question: 'Which printer model?',
            outcome: 'answered',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'here is the receipt' },
          {
            type: 'attachment',
            name: 'receipt.pdf',
            mediaType: 'application/pdf',
            text: 'Order 4711 — printer',
          },
        ],
      },
    ];

    const result = assembleContext(input({ history }));
    const block = result.blocks.at(-1);

    expect(block?.id).toBe('message-history');
    expect(result.messages).toEqual(history);
  });

  it('resolves the agent instructions for the locale', () => {
    const agent = {
      slug: 'assistant',
      instructions: 'Answer in plain language.',
      i18n: { de: { instructions: 'Antworte in einfacher Sprache.' } },
    };

    expect(resolveAgentInstructions(agent, 'de')).toBe(
      'Antworte in einfacher Sprache.',
    );
    // A region narrows to its base language before falling back.
    expect(resolveAgentInstructions(agent, 'de-CH')).toBe(
      'Antworte in einfacher Sprache.',
    );
    expect(resolveAgentInstructions(agent, 'fr')).toBe(
      'Answer in plain language.',
    );
    expect(assembleContext(input({ agent, locale: 'de' })).system).toContain(
      'Antworte in einfacher Sprache.',
    );
  });
});

describe('assembleContext — overflow', () => {
  const long = (marker: string) => `${marker} ${'x'.repeat(400)}`;

  it('drops the OLDEST messages and leaves a visible notice in their place', () => {
    const history = [
      message('user', long('first')),
      message('assistant', long('second')),
      message('user', long('third')),
      message('assistant', long('fourth')),
      message('user', long('newest')),
    ];

    const result = assembleContext(
      input({ history, budget: { maxTokens: 300 } }),
    );

    expect(result.truncation).toBeDefined();
    const dropped = result.truncation?.droppedMessages ?? 0;
    expect(dropped).toBeGreaterThan(0);

    // The notice is the first thing the model reads, and it says so plainly.
    // Role USER: the Anthropic wire hoists system-role messages into the
    // system prompt, which would tear the notice out of position.
    const [notice, ...kept] = result.messages;
    expect(notice?.role).toBe('user');
    expect(notice?.parts).toEqual([
      { type: 'text', text: truncationNotice(dropped) },
    ]);
    expect(truncationNotice(dropped)).toContain('not summarized');

    // What survives is the TAIL, byte-identical — nothing was rewritten,
    // compacted, or paraphrased on the way through.
    expect(kept).toEqual(history.slice(dropped));
    expect(kept.at(-1)).toEqual(history.at(-1));
  });

  it('never summarizes — the kept messages are the originals, not a digest', () => {
    const history = [
      message('user', long('alpha')),
      message('assistant', long('beta')),
      message('user', long('gamma')),
    ];

    const result = assembleContext(
      input({ history, budget: { maxTokens: 250 } }),
    );
    // Everything after the notice is an original — never a digest.
    const kept = result.truncation ? result.messages.slice(1) : result.messages;

    expect(result.truncation).toBeDefined();
    for (const message_ of kept) {
      expect(history).toContainEqual(message_);
    }
  });

  it('keeps the newest message even when it alone does not fit', () => {
    const history = [message('user', 'x'.repeat(40_000))];

    const result = assembleContext(
      input({ history, budget: { maxTokens: 100 } }),
    );

    expect(result.messages).toEqual(history);
    expect(result.truncation).toBeUndefined();
  });

  it('leaves a conversation that fits completely untouched', () => {
    const history = [message('user', 'hi'), message('assistant', 'hello')];

    const result = assembleContext(input({ history }));

    expect(result.messages).toEqual(history);
    expect(result.truncation).toBeUndefined();
  });

  it('counts the output reserve against the budget', () => {
    const history = [
      message('user', long('one')),
      message('assistant', long('two')),
      message('user', long('three')),
    ];

    const roomy = assembleContext(
      input({ history, budget: { maxTokens: 2000 } }),
    );
    const reserved = assembleContext(
      input({
        history,
        budget: { maxTokens: 2000, reserveOutputTokens: 1800 },
      }),
    );

    expect(roomy.truncation).toBeUndefined();
    expect(reserved.truncation?.droppedMessages).toBeGreaterThan(0);
  });

  it("folds a bounded read's omitted turns into the notice", () => {
    const history = [
      message('user', 'short question'),
      message('assistant', 'short answer'),
    ];

    const result = assembleContext(input({ history, historyOmittedCount: 7 }));

    expect(result.truncation?.droppedMessages).toBe(7);
    const [notice, ...kept] = result.messages;
    expect(notice?.parts).toEqual([
      { type: 'text', text: truncationNotice(7) },
    ]);
    expect(kept).toEqual(history);
  });

  it('protects the newest turns before older history', () => {
    const history = [
      message('user', long('one')),
      message('assistant', long('two')),
      message('user', long('three')),
      message('assistant', long('four')),
      message('user', long('five')),
      message('assistant', long('six')),
    ];
    // A budget sized to the system prompt plus exactly the four newest
    // turns (and the notice): the drop comes entirely out of the head — the
    // protected tail survives byte-identical.
    const systemTokens = estimateTokens(
      assembleContext(input({ history: [] })).system,
    );
    const tailTokens = history
      .slice(2)
      .reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    const result = assembleContext(
      input({
        history,
        budget: { maxTokens: systemTokens + tailTokens + 60 },
      }),
    );

    expect(result.truncation?.droppedMessages).toBe(2);
    expect(result.messages.slice(1)).toEqual(history.slice(2));
  });
});
