import { describe, expect, it } from 'vitest';

import {
  answerSchema,
  MAX_INTRO_LENGTH,
  MAX_OPTION_DESCRIPTION_LENGTH,
  formatAnswerSetForModel,
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTIONS_PER_SET,
  OTHER_OPTION_ID,
  questionSchema,
  questionSetSchema,
  type QuestionSet,
} from './questions';

const option = (label: string) => ({ label });

const question = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  question: `Question ${id}?`,
  options: [option('First'), option('Second')],
  ...overrides,
});

describe('questionSchema', () => {
  it('accepts a question offering two options', () => {
    expect(questionSchema.safeParse(question('purpose')).success).toBe(true);
  });

  // The whole reason this format exists: the shape it replaced let a model
  // author a blank box, and models did, every time.
  it('rejects a question with no options at all', () => {
    const result = questionSchema.safeParse({
      id: 'purpose',
      question: 'What is the purpose of this email?',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a question offering only one option', () => {
    const result = questionSchema.safeParse(
      question('purpose', { options: [option('Only')] }),
    );
    expect(result.success).toBe(false);
  });

  // Pinned to the literal for the same reason as the per-set cap: a radio
  // group stops reading as one past a handful, and the client adds `Other…`
  // on top, so what a person sees is at most five.
  it('caps a question at four model-authored options', () => {
    expect(MAX_OPTIONS_PER_QUESTION).toBe(4);
    const five = Array.from({ length: 5 }, (_, i) => option(`Option ${i}`));
    expect(
      questionSchema.safeParse(question('purpose', { options: five })).success,
    ).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => option(`Option ${i}`));
    expect(
      questionSchema.safeParse(question('purpose', { options: four })).success,
    ).toBe(true);
  });

  // Labels double as values, so duplicates would make the answer ambiguous.
  it('rejects duplicate option labels', () => {
    const result = questionSchema.safeParse(
      question('purpose', { options: [option('Same'), option('Same')] }),
    );
    expect(result.success).toBe(false);
  });

  // The client owns the escape hatch so it stays localised; a model claiming
  // the reserved id would collide with it.
  it('rejects an option claiming the reserved free-text id', () => {
    const result = questionSchema.safeParse(
      question('purpose', {
        options: [option('Real'), option(OTHER_OPTION_ID)],
      }),
    );
    expect(result.success).toBe(false);
  });

  it('keeps a single recommended badge as authored', () => {
    const result = questionSchema.safeParse(
      question('purpose', {
        options: [{ label: 'First', recommended: true }, option('Second')],
      }),
    );
    expect(result.success).toBe(true);
    expect(
      result.success ? result.data.options.map((o) => o.recommended) : [],
    ).toEqual([true, undefined]);
  });

  it('normalizes a double recommendation down to the first (at most one badge)', () => {
    // Clamp, don't refuse: a second `recommended: true` is a cosmetic
    // authoring slip — rejecting the set would cost the model a round trip,
    // while two badges would make the UI recommend nothing.
    const result = questionSchema.safeParse(
      question('purpose', {
        options: [
          { label: 'First', recommended: true },
          { label: 'Second', recommended: true },
        ],
      }),
    );
    expect(result.success).toBe(true);
    expect(
      result.success ? result.data.options.map((o) => o.recommended) : [],
    ).toEqual([true, undefined]);
  });

  it('rejects an unknown key rather than silently dropping it', () => {
    const result = questionSchema.safeParse(
      question('purpose', { type: 'textarea' }),
    );
    expect(result.success).toBe(false);
  });
});

describe('questionSetSchema', () => {
  it('accepts a set within the cap', () => {
    expect(
      questionSetSchema.safeParse({ questions: [question('a'), question('b')] })
        .success,
    ).toBe(true);
  });

  // Pinned to the literal, not to the constant: a test that derives its
  // fixture from MAX_QUESTIONS_PER_SET moves with it and would stay green if
  // someone raised the cap to 99. The bound is a product decision — stepping
  // pays off at five-to-ten fields, and four is where the reported form
  // started scrolling — so changing it should have to change this line.
  it('caps a set at four questions', () => {
    expect(MAX_QUESTIONS_PER_SET).toBe(4);
    const five = Array.from({ length: 5 }, (_, i) => question(`q${i}`));
    expect(questionSetSchema.safeParse({ questions: five }).success).toBe(
      false,
    );
    const four = Array.from({ length: 4 }, (_, i) => question(`q${i}`));
    expect(questionSetSchema.safeParse({ questions: four }).success).toBe(true);
  });

  it('rejects an empty set', () => {
    expect(questionSetSchema.safeParse({ questions: [] }).success).toBe(false);
  });

  it('rejects duplicate question ids', () => {
    const result = questionSetSchema.safeParse({
      questions: [question('same'), question('same')],
    });
    expect(result.success).toBe(false);
  });
});

describe('answerSchema', () => {
  it('accepts a picked option', () => {
    expect(
      answerSchema.safeParse({ questionId: 'purpose', selected: ['First'] })
        .success,
    ).toBe(true);
  });

  it('accepts free text with nothing selected', () => {
    expect(
      answerSchema.safeParse({
        questionId: 'purpose',
        selected: [],
        freeText: 'Something else entirely',
      }).success,
    ).toBe(true);
  });

  it('rejects an answer that selected nothing and typed nothing', () => {
    expect(
      answerSchema.safeParse({ questionId: 'purpose', selected: [] }).success,
    ).toBe(false);
  });

  it('rejects whitespace-only free text as an answer', () => {
    expect(
      answerSchema.safeParse({
        questionId: 'purpose',
        selected: [],
        freeText: '   ',
      }).success,
    ).toBe(false);
  });
});

describe('formatAnswerSetForModel', () => {
  const set: QuestionSet = {
    questions: [
      {
        id: 'purpose',
        question: "What's the purpose of this email?",
        options: [option('Request an approval'), option('Follow up')],
      },
      {
        id: 'tone',
        question: 'What tone should it take?',
        options: [option('Formal'), option('Warm')],
      },
    ],
  };

  it('pairs each question with what was chosen', () => {
    const text = formatAnswerSetForModel(set, [
      { questionId: 'purpose', selected: ['Request an approval'] },
      { questionId: 'tone', selected: ['Warm'] },
    ]);
    expect(text).toBe(
      "What's the purpose of this email? → Request an approval\n" +
        'What tone should it take? → Warm',
    );
  });

  // A typed answer and a picked one mean different things to the model: one
  // says "none of your options fit", the other confirms a guess.
  it('marks a typed answer as the person’s own words', () => {
    const text = formatAnswerSetForModel(set, [
      { questionId: 'purpose', selected: [], freeText: 'Chasing an invoice' },
    ]);
    expect(text).toBe(
      "What's the purpose of this email? → Chasing an invoice (in their own words)",
    );
  });

  it('omits questions that were never answered', () => {
    const text = formatAnswerSetForModel(set, [
      { questionId: 'tone', selected: ['Formal'] },
    ]);
    expect(text).toBe('What tone should it take? → Formal');
  });
});

// Length is a presentation problem, not a correctness one. Rejecting a whole
// set over a long intro cost a round trip and put a red failure in the
// transcript for something the client can fix by clipping a sentence.
describe('over-long display strings clamp instead of rejecting', () => {
  it('trims an intro past the cap and marks the cut', () => {
    const parsed = questionSetSchema.safeParse({
      intro: 'x'.repeat(MAX_INTRO_LENGTH + 200),
      questions: [question('purpose')],
    });
    expect(parsed.success).toBe(true);
    const intro = parsed.success ? (parsed.data.intro ?? '') : '';
    expect(intro).toHaveLength(MAX_INTRO_LENGTH);
    expect(intro.endsWith('…')).toBe(true);
  });

  it('trims a long option description', () => {
    const parsed = questionSchema.safeParse(
      question('purpose', {
        options: [
          { label: 'First', description: 'y'.repeat(500) },
          { label: 'Second' },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
    const description = parsed.success
      ? parsed.data.options[0]?.description
      : undefined;
    expect(description).toHaveLength(MAX_OPTION_DESCRIPTION_LENGTH);
  });

  // Structure still rejects: clamping is for how a thing READS, never for
  // what it MEANS. A question with one option is not a choice, however it is
  // trimmed.
  it('still rejects the structural rules', () => {
    expect(
      questionSchema.safeParse(question('p', { options: [option('Only')] }))
        .success,
    ).toBe(false);
    expect(
      questionSetSchema.safeParse({
        questions: Array.from({ length: 5 }, (_, i) => question(`q${i}`)),
      }).success,
    ).toBe(false);
  });

  // Labels are the answer VALUES and must stay unique, so they are the one
  // display string that must not be silently shortened.
  it('does not clamp option labels', () => {
    expect(
      questionSchema.safeParse(
        question('p', {
          options: [{ label: 'z'.repeat(200) }, option('Second')],
        }),
      ).success,
    ).toBe(false);
  });
});
