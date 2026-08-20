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
  RAG_SEARCH_ACTIONS,
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_KINDS,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_MIN_SIMILARITY,
  RAG_SEARCH_STATUS_VALUES,
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

function wireSchema(name: string): Record<string, unknown> {
  const tool = CHAT_WIRE_TOOLS.find((entry) => entry.name === name);
  if (!tool) throw new Error(`no wire tool named ${name}`);
  return tool.parameters;
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

  it('rag_search is honest about which rows carry a ref', () => {
    // Task rows carry one now — that ref IS the depth path, since chat has no
    // task tool. Projects deliberately do not: their row already holds
    // everything (name, key, open/done counts).
    const text = wireDescription('rag_search');
    expect(text).toMatch(/document, web-page and task rows carry\s+a "ref"/i);
    expect(text).toMatch(/project rows carry their content inline/i);
    expect(text).toMatch(/cannot\s+be fetched/i);
  });

  it('rag_search tells the model the workspace holds the work', () => {
    // Cause 2 of the epic: the loadout could search the board and the model
    // still recommended Asana/Monday/Jira, because nothing said the product
    // has tasks at all. The steer rides the description, not the persona.
    const text = wireDescription('rag_search');
    expect(text).toMatch(/tasks and projects/i);
    expect(text).toMatch(/never suggest an external task tracker/i);
  });

  it('rag_search offers a status filter and defines "open"', () => {
    const schema = wireSchema('rag_search');
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.status?.enum).toContain('open');
    expect(String(properties.status?.description)).toMatch(
      /not done and not cancelled/i,
    );
  });

  // The verb is the contract's spine: an omission must never silently become
  // a different operation, so `action` is the ONLY schema-required field and
  // both enums are closed. The schema, the executor, and this test all read
  // the same exported arrays, so none of the three can drift.
  it('rag_search requires the action verb and closes its enums', () => {
    const schema = wireSchema('rag_search');
    expect(at(schema, 'required')).toEqual(['action']);
    expect(at(schema, 'additionalProperties')).toBe(false);
    expect(at(schema, 'properties', 'action', 'enum')).toEqual([
      ...RAG_SEARCH_ACTIONS,
    ]);
    expect(at(schema, 'properties', 'kind', 'enum')).toEqual([
      ...RAG_SEARCH_KINDS,
    ]);
    expect(at(schema, 'properties', 'status', 'enum')).toEqual([
      ...RAG_SEARCH_STATUS_VALUES,
    ]);
  });

  it('rag_search splits search from list and stays honest about paging', () => {
    const text = wireDescription('rag_search');
    expect(text).toContain('action="search"');
    expect(text).toContain('action="list"');
    expect(text).toMatch(/browses ONE kind/);
    // The two first-call traps: a named item is not a list, and a bare state
    // question is not a search.
    expect(text).toMatch(/named item is a search/i);
    expect(text).toMatch(/task dump\s+is refused/i);
    // Paging honesty rides the description, like rag_fetch's nextOffset rule.
    expect(text).toContain('hasMore');
    expect(text).toContain('continueCursor');
    expect(text).toMatch(/never present one page/i);
    // Empty searches steer to the list verb, not to rewording.
    expect(text).toMatch(/switch to action="list"/i);
  });

  // The description dropped its offset parenthetical because rag_fetch's own
  // `offset` field carries the fact at the moment it matters — this pins the
  // dependency so a rewrite there cannot orphan the contract.
  it('rag_fetch still explains the offset a rag_search hit carries', () => {
    const offsetDescription = String(
      at(wireSchema('rag_fetch'), 'properties', 'offset', 'description'),
    );
    expect(offsetDescription).toMatch(/rag_search hit.s\s+"offset"/i);
    expect(offsetDescription).toMatch(/land on the match/i);
  });

  it('rag_fetch accepts a task ref and says what it returns', () => {
    const text = wireDescription('rag_fetch');
    expect(text).toMatch(/task ref/i);
    expect(text).toMatch(/comments, subtasks and blockers/i);
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

  it('web_fetch pages like rag_fetch and owns the same partial-read rule', () => {
    const text = wireDescription('web_fetch');
    expect(text).toContain('nextOffset');
    expect(text).toMatch(/never present a partial read/i);
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
