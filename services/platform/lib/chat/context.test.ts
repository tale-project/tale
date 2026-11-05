import { describe, expect, it } from 'vitest';

import {
  assembleContext,
  CONTEXT_BLOCK_ORDER,
  resolveAgentInstructions,
  SHORTENED_TOOL_RESULT_NOTE,
  truncationNotice,
  type ContextInput,
} from './context';
import type { TaskHandover } from './handover';
import type { ChatMessage } from './types';
import { estimateMessageTokens, estimateTokens } from './types';
import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from './untrusted-content';
import { explodeMessagesForWire } from './wire-parts';

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

/** A person with one project that has an agent, in German. */
const HANDOVER: TaskHandover = {
  projectsWithAgents: ['Website relaunch'],
  projectsWithoutAgents: 1,
  canAddAgents: false,
  automationOff: false,
  standardAgent: false,
  labels: {
    createTask: 'Aufgabe erstellen',
    createAndStart: 'Erstellen und Agent starten',
    assignee: 'Zuständig',
    createAgent: 'Agent erstellen …',
    standardAgent: 'Standard-Agent',
  },
};

describe('assembleContext', () => {
  it('emits the blocks in exactly the contracted order', () => {
    // Every optional block present, so the assembled list is the whole
    // contract rather than a subsequence of it.
    const result = assembleContext(
      input({
        project: { name: 'Growth', instructions: 'Ship weekly.' },
        taskHandover: HANDOVER,
        skillCatalog: [{ slug: 'docx', description: 'Word documents' }],
        chosenSkills: ['docx'],
        customInstructions: 'Reply tersely.',
      }),
    );

    expect(result.blocks.map((block) => block.id)).toEqual([
      ...CONTEXT_BLOCK_ORDER,
    ]);
  });

  it('carries the person’s hand-over note after the breakpoint, never in the cached prefix', () => {
    const result = assembleContext(
      input({ taskHandover: HANDOVER, customInstructions: 'Reply tersely.' }),
    );
    const ids = result.blocks.map((block) => block.id);

    expect(ids.indexOf('task-handover')).toBeGreaterThan(
      ids.indexOf('runtime-directives'),
    );
    expect(ids.indexOf('task-handover')).toBeLessThan(
      ids.indexOf('custom-instructions'),
    );
    expect(result.stablePrefix).not.toContain('Website relaunch');
    expect(result.volatileSuffix).toContain('"Aufgabe erstellen"');
    expect(result.volatileSuffix).toContain('Website relaunch');
  });

  it('leaves the hand-over note out of a sub-agent turn and a turn without one', () => {
    const subAgent = assembleContext(
      input({ taskHandover: HANDOVER, isSubAgentTurn: true }),
    );
    const without = assembleContext(input());

    expect(subAgent.blocks.map((block) => block.id)).not.toContain(
      'task-handover',
    );
    expect(without.blocks.map((block) => block.id)).not.toContain(
      'task-handover',
    );
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
    // The parallel-lookup steer is part of the tool-docs block — static
    // text, so it lives above the breakpoint with the docs it steers.
    expect(result.stablePrefix).toContain('Lookups are budgeted per reply');
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

  /**
   * The directive let the prompt's language win, so a REST send's `locale`
   * (documented as the language the assistant answers in) read as doing
   * nothing on an English prompt. A caller that FIXED the locale gets a
   * directive that names the language in words — the raw tag alone
   * ("Answer in de …") still lost to the prompt's language on a reasoning
   * model with a short prompt; the app lane, which never sets the flag,
   * keeps the directive it always had.
   */
  it('names the reply language when the caller fixed the locale, and lets the prompt win otherwise', () => {
    const fixed = assembleContext(input({ locale: 'de', localeFixed: true }));
    expect(fixed.system).toContain(
      "Reply language: German (de). Write the whole reply in German, whatever language the user writes in — the caller fixed the reply language; do not switch to the user's language.",
    );
    expect(fixed.system).not.toContain("Respond in the user's language");
    // A tag the runtime has no name for still reads as itself, twice.
    expect(
      assembleContext(input({ locale: 'xx', localeFixed: true })).system,
    ).toContain('Reply language: xx (xx). Write the whole reply in xx,');

    const open = assembleContext(input({ locale: 'de' }));
    expect(open.system).toContain(
      "Respond in the user's language (de). If the user writes in another language, answer in the language they used.",
    );
    expect(open.system).not.toContain('the caller fixed the reply language');
    // Either way the directive sits in the volatile suffix, after the
    // cache breakpoint — never in the cached prefix.
    for (const result of [fixed, open]) {
      const ids = result.blocks.map((block) => block.id);
      expect(ids.indexOf('runtime-directives')).toBeGreaterThan(
        ids.indexOf('cache-breakpoint'),
      );
      expect(result.stablePrefix).not.toContain('language');
    }
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

/**
 * A reply that read a page answered from all of it. Sending the next turn a
 * 400-character stub of that page beside the answer made the answer look
 * unsupported, and a careful model corrected itself and read the page again
 * (#5356). So an earlier tool result goes out whole while the history fits.
 */
describe('assembleContext — earlier tool results', () => {
  /** A stored reply that read one page and answered from it: call, result
   * and answer as ordered parts of one assistant message. */
  function readAndAnswered(
    callId: string,
    content: string,
    answer: string,
  ): ChatMessage {
    const url = `https://docs.tale.dev/${callId}`;
    return {
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          callId,
          capabilityId: 'web_fetch',
          input: { url },
        },
        {
          type: 'tool-result',
          callId,
          capabilityId: 'web_fetch',
          output: { url, content },
          structured: true,
        },
        { type: 'text', text: answer },
      ],
    };
  }

  /** The same reply as a later turn gets it once its page was shortened to
   * make room: call and answer as stored, the page cut to its first 400
   * characters beside the note that says so. */
  function shortened(reply: ChatMessage): ChatMessage {
    return {
      ...reply,
      parts: reply.parts.map((part) => {
        if (part.type !== 'tool-result') return part;
        const { url, content } = part.output as {
          url: string;
          content: string;
        };
        return {
          ...part,
          output: {
            note: SHORTENED_TOOL_RESULT_NOTE,
            result: {
              url,
              content: `${content.slice(0, 400)}…(+${content.length - 400} chars)`,
            },
          },
        };
      }),
    };
  }

  const systemTokens = () =>
    estimateTokens(assembleContext(input({ history: [] })).system);
  const tokens = (messages: readonly ChatMessage[]) =>
    messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);

  it('sends an earlier tool result whole while the history fits (#5356)', () => {
    const history = [
      message('user', 'Wie lege ich einen Projekt-Agenten an?'),
      readAndAnswered('c1', 'a'.repeat(20_000), 'So legst du ihn an: …'),
      message('user', 'Fasse deine letzte Antwort zusammen.'),
    ];

    const result = assembleContext(
      input({ history, budget: { maxTokens: 100_000 } }),
    );

    expect(result.messages).toEqual(history);
    expect(result.truncation).toBeUndefined();
  });

  it('shortens the oldest result first on overflow, and says so where the model reads it (#5356)', () => {
    const ask = message('user', 'Erste Frage');
    const older = readAndAnswered('c1', 'a'.repeat(20_000), 'Erste Antwort.');
    const askAgain = message('user', 'Zweite Frage');
    const newer = readAndAnswered('c2', 'b'.repeat(20_000), 'Zweite Antwort.');
    const followUp = message('user', 'Dritte Frage');
    // Room for the whole history once the older page is shortened, not
    // before: the newer page stays whole and no message is dropped.
    const expected = [ask, shortened(older), askAgain, newer, followUp];

    const result = assembleContext(
      input({
        history: [ask, older, askAgain, newer, followUp],
        budget: { maxTokens: systemTokens() + tokens(expected) },
      }),
    );

    expect(result.truncation).toBeUndefined();
    expect(result.messages).toEqual(expected);
    const [shortenedPage, wholePage] = explodeMessagesForWire(
      result.system,
      result.messages,
    ).flatMap((turn) => turn.toolResults ?? []);
    expect(shortenedPage?.callId).toBe('c1');
    expect(shortenedPage?.content).toContain(SHORTENED_TOOL_RESULT_NOTE);
    expect(shortenedPage?.content).toContain('…(+19600 chars)');
    expect(wholePage?.callId).toBe('c2');
    expect(wholePage?.content).toContain('b'.repeat(20_000));
  });

  it('drops the oldest messages only once every result is shortened', () => {
    const first = readAndAnswered('c1', 'a'.repeat(20_000), 'Erste Antwort.');
    const second = readAndAnswered('c2', 'b'.repeat(20_000), 'Zweite Antwort.');
    const third = readAndAnswered('c3', 'c'.repeat(20_000), 'Dritte Antwort.');
    const history = [
      message('user', 'Erste Frage'),
      first,
      message('user', 'Zweite Frage'),
      second,
      message('user', 'Dritte Frage'),
      third,
      message('user', 'Vierte Frage'),
    ];
    // Every page shortened still leaves too much: the two oldest messages
    // go, what they free holds the notice, and the kept replies carry their
    // pages shortened.
    const kept = [
      message('user', 'Zweite Frage'),
      shortened(second),
      message('user', 'Dritte Frage'),
      shortened(third),
      message('user', 'Vierte Frage'),
    ];

    const result = assembleContext(
      input({
        history,
        budget: { maxTokens: systemTokens() + tokens(kept) + 60 },
      }),
    );

    expect(result.truncation?.droppedMessages).toBe(2);
    expect(result.messages).toEqual([
      message('user', truncationNotice(2)),
      ...kept,
    ]);
  });

  it('gives the room the dropped messages freed back to the newest results', () => {
    const pasted = message('user', `Hier ist der Text: ${'p'.repeat(60_000)}`);
    const older = readAndAnswered('c1', 'a'.repeat(20_000), 'Erste Antwort.');
    const askAgain = message('user', 'Zweite Frage');
    const newer = readAndAnswered('c2', 'b'.repeat(20_000), 'Zweite Antwort.');
    const followUp = message('user', 'Dritte Frage');
    const history = [pasted, older, askAgain, newer, followUp];
    // The pasted text overflows the window with every page shortened, so it
    // goes; the room it frees keeps the newer page whole.
    const kept = [shortened(older), askAgain, newer, followUp];

    const result = assembleContext(
      input({
        history,
        budget: {
          maxTokens:
            systemTokens() +
            tokens(kept) +
            estimateTokens(truncationNotice(history.length)),
        },
      }),
    );

    expect(result.truncation?.droppedMessages).toBe(1);
    expect(result.messages).toEqual([
      message('user', truncationNotice(1)),
      ...kept,
    ]);
  });

  it('leaves a result whole that shortening would not make smaller', () => {
    const ticket: ChatMessage = {
      role: 'assistant',
      parts: [
        {
          type: 'tool-call',
          callId: 'c1',
          capabilityId: 'connector.zendesk.create_ticket',
          input: { subject: 'printer' },
        },
        {
          type: 'tool-result',
          callId: 'c1',
          capabilityId: 'connector.zendesk.create_ticket',
          output: { id: 42 },
          structured: true,
        },
        { type: 'text', text: 'Ticket 42 ist angelegt.' },
      ],
    };
    const history = [
      message('user', 'x'.repeat(4_000)),
      message('assistant', 'Gelesen.'),
      message('user', 'Leg ein Ticket an.'),
      ticket,
      message('user', 'Danke.'),
    ];

    const result = assembleContext(
      input({
        history,
        budget: { maxTokens: systemTokens() + tokens(history.slice(1)) + 60 },
      }),
    );

    expect(result.truncation?.droppedMessages).toBe(1);
    expect(result.messages.slice(1)).toEqual(history.slice(1));
  });

  it('never shortens what a person or the assistant wrote, only tool output', () => {
    const pasted = message('user', `Hier ist der Text: ${'p'.repeat(20_000)}`);
    const reply = readAndAnswered(
      'c1',
      'a'.repeat(20_000),
      `Zusammenfassung: ${'s'.repeat(4_000)}`,
    );
    const followUp = message('user', 'Und jetzt kürzer.');
    const expected = [pasted, shortened(reply), followUp];

    const result = assembleContext(
      input({
        history: [pasted, reply, followUp],
        budget: { maxTokens: systemTokens() + tokens(expected) },
      }),
    );

    expect(result.truncation).toBeUndefined();
    expect(result.messages).toEqual(expected);
  });
});

/**
 * The person's own standing instructions are the one per-person block. The
 * load-bearing placement is the opposite of the project's: they sit AFTER the
 * cache breakpoint, so the prefix a provider caches stays byte-identical for
 * every user of the agent, and a person turning their instructions on or off
 * never invalidates anyone else's cache.
 */
describe('assembleContext — custom instructions', () => {
  it('omits the block when the person has none, or only whitespace', () => {
    for (const customInstructions of [undefined, '', '   \n']) {
      const result = assembleContext(input({ customInstructions }));
      expect(result.blocks.map((block) => block.id)).not.toContain(
        'custom-instructions',
      );
      expect(result.system).not.toContain('Standing instructions');
    }
  });

  it('rides the volatile suffix after the clock, never the cached prefix', () => {
    const result = assembleContext(
      input({ customInstructions: 'Reply tersely.' }),
    );
    const ids = result.blocks.map((block) => block.id);
    expect(ids.indexOf('custom-instructions')).toBeGreaterThan(
      result.cacheBreakpointIndex,
    );
    expect(ids.indexOf('custom-instructions')).toBeGreaterThan(
      ids.indexOf('runtime-directives'),
    );
    expect(result.stablePrefix).not.toContain('Reply tersely.');
    expect(result.volatileSuffix).toContain('Reply tersely.');
    expect(result.system).toBe(
      `${result.stablePrefix}\n\n${result.volatileSuffix}`,
    );
  });

  it('leaves the cached prefix byte-identical with and without them', () => {
    const without = assembleContext(input());
    const withThem = assembleContext(
      input({ customInstructions: 'Reply tersely.' }),
    );
    expect(withThem.stablePrefix).toBe(without.stablePrefix);
    expect(withThem.cacheBreakpointIndex).toBe(without.cacheBreakpointIndex);
  });

  it('frames them as the person’s own voice, ranked below the org and project', () => {
    const result = assembleContext(
      input({ customInstructions: '  Reply tersely.\n' }),
    );
    const block = result.blocks.find((b) => b.id === 'custom-instructions');
    const text = block && 'text' in block ? block.text : '';
    expect(text).toContain(
      'Standing instructions from the person you are talking to',
    );
    expect(text).toContain('those take precedence');
    expect(text.endsWith('Reply tersely.')).toBe(true);
  });

  it('is skipped on a sub-agent turn, like the org’s instructions', () => {
    const result = assembleContext(
      input({ isSubAgentTurn: true, customInstructions: 'Reply tersely.' }),
    );
    expect(result.blocks.map((block) => block.id)).not.toContain(
      'custom-instructions',
    );
    expect(result.system).not.toContain('Reply tersely.');
  });
});

describe('assembleContext — project context', () => {
  it('omits the block entirely for an unbound thread', () => {
    const result = assembleContext(input());
    expect(result.blocks.map((block) => block.id)).not.toContain(
      'project-context',
    );
  });

  // The load-bearing placement: a thread's project never changes, so the block
  // belongs in the CACHED prefix. Emitting it after the breakpoint would
  // re-send it every turn and invalidate the prefix for nothing.
  it('sits inside the cached stable prefix, before the breakpoint', () => {
    const result = assembleContext(input({ project: { name: 'Growth' } }));
    const ids = result.blocks.map((block) => block.id);
    expect(ids.indexOf('project-context')).toBeLessThan(
      result.cacheBreakpointIndex,
    );
    expect(result.stablePrefix).toContain('Growth');
    expect(result.volatileSuffix).not.toContain('Growth');
  });

  it("carries the project's standing instructions when it has them", () => {
    const result = assembleContext(
      input({
        project: {
          name: 'Growth',
          instructions: 'Always quote the campaign id.',
        },
      }),
    );
    const block = result.blocks.find((b) => b.id === 'project-context');
    const text = block && 'text' in block ? block.text : '';
    expect(text).toContain('Growth');
    expect(text).toContain('Always quote the campaign id.');
  });

  it('names the project without a dangling instructions header when it has none', () => {
    const result = assembleContext(input({ project: { name: 'Growth' } }));
    const block = result.blocks.find((b) => b.id === 'project-context');
    const text = block && 'text' in block ? block.text : '';
    expect(text).toContain('Growth');
    expect(text).not.toMatch(/instructions for this project/i);
  });

  // The boundary sentence: a project chat's tools reach the project's files
  // and the organization's shared knowledge, and no other project. The
  // executor enforces exactly that server-side; the prompt says it so the
  // model neither walks the project list for "the project's files" nor
  // apologises for the boundary. The key is the handle people use.
  it('states the scope boundary, with the project key when it has one', () => {
    const result = assembleContext(
      input({ project: { name: 'Growth', key: 'GRW' } }),
    );
    const block = result.blocks.find((b) => b.id === 'project-context');
    const text = block && 'text' in block ? block.text : '';
    expect(text).toContain(
      'This conversation belongs to project "Growth" (GRW). Your tools ' +
        "reach this project's files and the organization's shared " +
        'knowledge; other projects are out of scope in this chat.',
    );
    expect(text).not.toMatch(/anything else the user can read/i);
  });

  it('names the project without a key when the row has none', () => {
    const result = assembleContext(input({ project: { name: 'Growth' } }));
    const block = result.blocks.find((b) => b.id === 'project-context');
    const text = block && 'text' in block ? block.text : '';
    expect(text).toContain('This conversation belongs to project "Growth". ');
    expect(text).not.toContain('()');
  });

  it('treats a blank project name as no project', () => {
    const result = assembleContext(input({ project: { name: '   ' } }));
    expect(result.blocks.map((block) => block.id)).not.toContain(
      'project-context',
    );
  });
});

describe('assembleContext — the skill catalog', () => {
  const CATALOG = [
    { slug: 'docx', description: 'Word documents' },
    { slug: 'house-style', description: 'How we write' },
  ];

  it("lists the person's skills after the breakpoint, never in the cached prefix", () => {
    const result = assembleContext(input({ skillCatalog: CATALOG }));
    const ids = result.blocks.map((block) => block.id);
    expect(ids.indexOf('available-skills')).toBeGreaterThan(
      ids.indexOf('cache-breakpoint'),
    );
    expect(result.stablePrefix).not.toContain('house-style');
    expect(result.volatileSuffix).toContain(
      '- docx: <skill-description>Word documents</skill-description>',
    );
    expect(result.system).toContain('load_skill');
  });

  it('names the skills the person chose after the catalog, per reply [CHAT-R29]', () => {
    const result = assembleContext(
      input({ skillCatalog: CATALOG, chosenSkills: ['docx', 'house-style'] }),
    );
    const ids = result.blocks.map((block) => block.id);
    expect(ids.indexOf('chosen-skills')).toBe(
      ids.indexOf('available-skills') + 1,
    );
    expect(result.stablePrefix).not.toContain('chose');
    expect(result.volatileSuffix).toContain(
      'The person chose these skills for this reply: docx, house-style.',
    );
    expect(
      assembleContext(
        input({ chosenSkills: ['docx'], isSubAgentTurn: true }),
      ).blocks.map((block) => block.id),
    ).not.toContain('chosen-skills');
  });

  it('renders nothing for an empty catalog or a sub-agent turn', () => {
    expect(
      assembleContext(input({ skillCatalog: [] })).blocks.map(
        (block) => block.id,
      ),
    ).not.toContain('available-skills');
    expect(
      assembleContext(
        input({ skillCatalog: CATALOG, isSubAgentTurn: true }),
      ).blocks.map((block) => block.id),
    ).not.toContain('available-skills');
  });
});
