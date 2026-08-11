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
  CHAT_TOOL_NAMES,
  CHAT_WIRE_TOOLS,
  isAwaitingAnswerResult,
  isPausingChatTool,
} from './tools';

/** The `ask_question` argument schema, as the model is handed it. */
function askQuestionSchema(): Record<string, unknown> {
  const tool = CHAT_WIRE_TOOLS.find((entry) => entry.name === 'ask_question');
  if (!tool) throw new Error('ask_question is not on the wire');
  return tool.parameters;
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

describe('the chat loadout', () => {
  // The loadout is a product boundary, not a default. A tool appearing here
  // without that decision having been made is the thing this pins.
  it('is exactly the four agreed tools', () => {
    expect([...CHAT_TOOL_NAMES]).toEqual([
      'rag_search',
      'rag_fetch',
      'web_fetch',
      'ask_question',
    ]);
    expect(CHAT_WIRE_TOOLS.map((tool) => tool.name)).toEqual([
      ...CHAT_TOOL_NAMES,
    ]);
  });

  it('pauses the turn for asking and nothing else', () => {
    expect(isPausingChatTool('ask_question')).toBe(true);
    for (const name of ['rag_search', 'rag_fetch', 'web_fetch']) {
      expect(isPausingChatTool(name)).toBe(false);
    }
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
