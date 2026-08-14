import { describe, expect, it } from 'vitest';

import {
  MAX_INTRO_LENGTH,
  MAX_OPTIONS_PER_QUESTION,
  MAX_OPTION_DESCRIPTION_LENGTH,
  MAX_OPTION_LABEL_LENGTH,
  MAX_QUESTIONS_PER_SET,
  MAX_QUESTION_HEADER_LENGTH,
  MAX_QUESTION_LENGTH,
  MIN_OPTIONS_PER_QUESTION,
  questionSetSchema,
} from '../shared/schemas/questions';
import { isRecord } from '../utils/type-utils';
import {
  ASK_QUESTION_TOOL,
  CHAT_TOOL_DOCS,
  CHAT_TOOL_NAMES,
  CHAT_WIRE_TOOLS,
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_MIN_SIMILARITY,
  isAwaitingAnswerResult,
  isPausingChatTool,
} from './tools';

/** The `ask_question` argument schema — off the wire, but the dormant
 * definition must keep agreeing with the shared Zod bounds. */
function askQuestionSchema(): Record<string, unknown> {
  return ASK_QUESTION_TOOL.parameters;
}

/**
 * Read one value out of the schema by path. A JSON Schema literal has no
 * TypeScript shape to walk, and typing it `any` to dot into it would turn off
 * exactly the checking this suite is here to provide — so the walk is
 * explicit and throws on a path that has gone missing, which is itself the
 * failure worth reporting.
 */
function at(root: unknown, ...path: readonly string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (!isRecord(cursor)) {
      throw new Error(
        `schema path stops short at "${key}" (${path.join('.')})`,
      );
    }
    cursor = cursor[key];
  }
  return cursor;
}

/** Shorthand for the per-question and per-option property bags. */
const QUESTION = ['properties', 'questions', 'items', 'properties'] as const;
const OPTION = [...QUESTION, 'options', 'items', 'properties'] as const;

function wireDescription(name: string): string {
  const tool = CHAT_WIRE_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`no wire tool named ${name}`);
  return tool.description;
}

/**
 * The wire descriptions are the PRIMARY steer — when to call, when not to,
 * what comes back, and which tool follows — while the system prompt carries
 * only a one-line summary per tool. These tests lock the load-bearing
 * clauses of that contract without freezing the prose: a rewrite may say it
 * differently, but it may not stop saying it.
 */

describe('CHAT_WIRE_TOOLS — the model-facing contract', () => {
  it('covers exactly the fixed loadout, in order', () => {
    expect(CHAT_WIRE_TOOLS.map((tool) => tool.name)).toEqual([
      ...CHAT_TOOL_NAMES,
    ]);
  });

  it('rag_search says when NOT to call and where to go on empty', () => {
    const text = wireDescription('rag_search');
    expect(text).toMatch(/not for general knowledge/i);
    expect(text).toMatch(/do not\s+re-run reworded/i);
    expect(text).toContain('web_fetch');
  });

  it('rag_search is honest that only document and web-page rows carry a ref', () => {
    const text = wireDescription('rag_search');
    expect(text).toMatch(/only document and web-page rows carry a "ref"/i);
    expect(text).toMatch(/cannot\s+be fetched/i);
  });

  it('rag_search explains the score as ordering, not similarity', () => {
    expect(wireDescription('rag_search')).toMatch(
      /"score"\s+orders hits within one response only/i,
    );
  });

  it('rag_fetch owns fetch-before-quoting and the direct attachment path', () => {
    const text = wireDescription('rag_fetch');
    expect(text).toMatch(/fetch before quoting/i);
    expect(text).toMatch(/do not rag_search .* whose ref you\s+already hold/i);
  });

  it('rag_fetch forbids passing off a partial read as the whole source', () => {
    const text = wireDescription('rag_fetch');
    expect(text).toMatch(/never present a partial read/i);
    expect(text).toMatch(/which part you read/i);
  });

  it('web_fetch is the escalation when org knowledge did not answer', () => {
    const text = wireDescription('web_fetch');
    expect(text).toMatch(/knowledge did not answer/i);
    expect(text).toContain('rag_fetch');
    // The old wording walled the tool off from anything org-adjacent.
    expect(text).not.toMatch(/only for pages outside/i);
  });

  it('names no real-world domain — steering is generic, never per-eval', () => {
    for (const tool of CHAT_WIRE_TOOLS) {
      expect(tool.description).not.toMatch(/https:\/\/[a-z0-9]/i);
      expect(tool.description).not.toMatch(/\b[a-z0-9-]+\.(com|org|net|io)\b/i);
    }
  });
});

describe('the chat loadout', () => {
  // The loadout is a product boundary, not a default. A tool appearing here
  // without that decision having been made is the thing this pins.
  it('is exactly the three agreed tools', () => {
    expect([...CHAT_TOOL_NAMES]).toEqual([
      'rag_search',
      'rag_fetch',
      'web_fetch',
    ]);
    expect(CHAT_WIRE_TOOLS.map((tool) => tool.name)).toEqual([
      ...CHAT_TOOL_NAMES,
    ]);
  });

  // Built with #2965, declined by the product owner (2026-08-14): the
  // machinery stays, the wire does not carry it. This pins the DECISION —
  // re-adding the tool must be deliberate, not a merge artifact.
  it('keeps ask_question off the wire', () => {
    expect(CHAT_WIRE_TOOLS.some((tool) => tool.name === 'ask_question')).toBe(
      false,
    );
    expect(CHAT_TOOL_DOCS.some((doc) => doc.id === 'ask_question')).toBe(false);
  });

  it('pauses the turn for asking and nothing else', () => {
    expect(isPausingChatTool('ask_question')).toBe(true);
    for (const name of ['rag_search', 'rag_fetch', 'web_fetch']) {
      expect(isPausingChatTool(name)).toBe(false);
    }
  });
});

describe('CHAT_TOOL_DOCS — the system-prompt one-liners', () => {
  it('is one short line per tool, far shorter than the wire description', () => {
    for (const doc of CHAT_TOOL_DOCS) {
      expect(doc.description).not.toContain('\n');
      expect(doc.description.length).toBeLessThan(120);
      expect(doc.description.length).toBeLessThan(
        wireDescription(doc.id).length / 2,
      );
    }
  });

  it('lists every tool exactly once, in loadout order', () => {
    expect(CHAT_TOOL_DOCS.map((doc) => doc.id)).toEqual([...CHAT_TOOL_NAMES]);
  });
});

describe('rag_search constants', () => {
  it('keeps the similarity floor inside the cosine range', () => {
    expect(RAG_SEARCH_MIN_SIMILARITY).toBeGreaterThan(0);
    expect(RAG_SEARCH_MIN_SIMILARITY).toBeLessThan(1);
  });

  it('orders the caps: entity leg ≤ default ≤ max', () => {
    expect(RAG_SEARCH_ENTITY_LIMIT).toBeLessThanOrEqual(
      RAG_SEARCH_DEFAULT_LIMIT,
    );
    expect(RAG_SEARCH_DEFAULT_LIMIT).toBeLessThanOrEqual(RAG_SEARCH_MAX_LIMIT);
  });
});

// The wire schema is what the MODEL is told; the Zod schema is what the
// boundary ENFORCES. If they disagree the model gets rejected for obeying its
// own contract, which reads as the tool being broken.
describe('the ask_question wire schema agrees with the Zod schema', () => {
  it('requires the question list and nothing optional', () => {
    const schema = askQuestionSchema();
    expect(at(schema, 'required')).toEqual(['questions']);
    expect(at(schema, 'additionalProperties')).toBe(false);
  });

  it('carries the same per-set cap', () => {
    const schema = askQuestionSchema();
    expect(at(schema, 'properties', 'questions', 'minItems')).toBe(1);
    expect(at(schema, 'properties', 'questions', 'maxItems')).toBe(
      MAX_QUESTIONS_PER_SET,
    );
  });

  it('carries the same option bounds', () => {
    const schema = askQuestionSchema();
    expect(at(schema, ...QUESTION, 'options', 'minItems')).toBe(
      MIN_OPTIONS_PER_QUESTION,
    );
    expect(at(schema, ...QUESTION, 'options', 'maxItems')).toBe(
      MAX_OPTIONS_PER_QUESTION,
    );
  });

  // Every bounded STRING, not just the arrays. The first version of this
  // suite checked only minItems/maxItems, so the wire schema declared no
  // maxLength at all — a model wrote a 300+ character intro it had no way to
  // know was too long, and the boundary rejected it for obeying its own
  // contract. An undeclared bound is a bound the model cannot honour.
  it('declares every string length the Zod schema enforces', () => {
    const schema = askQuestionSchema();
    expect(at(schema, 'properties', 'intro', 'maxLength')).toBe(
      MAX_INTRO_LENGTH,
    );
    expect(at(schema, ...QUESTION, 'question', 'maxLength')).toBe(
      MAX_QUESTION_LENGTH,
    );
    expect(at(schema, ...QUESTION, 'header', 'maxLength')).toBe(
      MAX_QUESTION_HEADER_LENGTH,
    );
    expect(at(schema, ...OPTION, 'label', 'maxLength')).toBe(
      MAX_OPTION_LABEL_LENGTH,
    );
    expect(at(schema, ...OPTION, 'description', 'maxLength')).toBe(
      MAX_OPTION_DESCRIPTION_LENGTH,
    );
  });

  // The regression itself: an intro of the length the model actually wrote.
  it('accepts an intro that explains why it is asking', () => {
    const intro =
      'I searched the knowledge base for Bergmann Logistics and found ' +
      'nothing — no contact, product, or knowledge entry. Note that documents ' +
      'and website search are currently unavailable (the organization has no ' +
      'embedding model configured), so I cannot check uploaded files or ' +
      'crawled pages either. I will need a few details from you.';
    expect(intro.length).toBeGreaterThan(MAX_QUESTION_LENGTH);
    expect(
      questionSetSchema.safeParse({
        intro,
        questions: [
          {
            id: 'purpose',
            question: 'What is the purpose?',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  // The whole point of the format: there is no way to spell a blank box.
  it('makes options mandatory on every question', () => {
    const schema = askQuestionSchema();
    expect(at(schema, 'properties', 'questions', 'items', 'required')).toEqual([
      'id',
      'question',
      'options',
    ]);
    expect(at(schema, ...QUESTION, 'type')).toBeUndefined();
  });

  it('accepts a call the wire schema would allow', () => {
    const call = {
      questions: [
        {
          id: 'purpose',
          question: "What's the purpose of this email?",
          options: [
            { label: 'Request an approval' },
            { label: 'Follow up on a meeting' },
          ],
        },
      ],
    };
    expect(questionSetSchema.safeParse(call).success).toBe(true);
  });
});

describe('isAwaitingAnswerResult', () => {
  it('recognises a registered question', () => {
    expect(
      isAwaitingAnswerResult({
        status: 'awaiting-answer',
        requestId: 'approval_1',
        question: 'Why?',
      }),
    ).toBe(true);
  });

  // A rejected call must NOT read as awaiting an answer, or the turn would
  // settle with no question pending and no reply coming.
  it('rejects an error result', () => {
    expect(
      isAwaitingAnswerResult({ status: 'invalid_args', message: 'nope' }),
    ).toBe(false);
    expect(isAwaitingAnswerResult(null)).toBe(false);
    expect(isAwaitingAnswerResult('awaiting-answer')).toBe(false);
    expect(isAwaitingAnswerResult({ status: 'awaiting-answer' })).toBe(false);
  });
});
