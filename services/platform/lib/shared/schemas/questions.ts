/**
 * The clarifying-question set — one shape, shared by every lane that asks a
 * person something mid-turn (chat's `ask_question`, the task/automation
 * lane's `ask_human`).
 *
 * The one rule this schema exists to enforce: **a question always offers
 * options**. The format this replaced had ten field types — `text`,
 * `textarea`, `number`, `email`, `url`, `tel`, `single_select`,
 * `multi_select`, `yes_no`, `todo_list` — and a tool description that said,
 * in capitals, never to present choices as plain text. Models wrote
 * `textarea` for every field anyway, and what reached the user was a form:
 * four blank boxes with the examples buried in a subtitle. Prose did not hold
 * the line, so the shape does: `options` is REQUIRED and there is no
 * free-text question type at all. A model that wants an open answer offers
 * the choices it can name; the client adds the escape hatch.
 *
 * Consequences of that inversion, each deliberate:
 *
 *  - **`Other…` is injected by the client, never authored by the model** (see
 *    {@link OTHER_OPTION_ID}). It is therefore always present, always spelled
 *    the same, and always LOCALISED — a model-authored "Other" would ship
 *    English into a German conversation.
 *  - **`yes_no` and `todo_list` are gone.** Yes/No is two options; a checklist
 *    is not a clarifying question.
 *  - **The label IS the value.** The previous format let an option carry a
 *    separate `value`, which meant every answer had to be mapped back to a
 *    label before the model could read it. Labels are unique per question
 *    instead, so the answer the user picked is the answer the model gets.
 *
 * Counts are bounded on purpose. One-question-at-a-time lifts completion, but
 * the research is equally clear that the gain lives at five-to-ten fields and
 * that stepping three or fewer can cost more than it returns — so a set is
 * capped at {@link MAX_QUESTIONS_PER_SET}, and the UI drops its progress
 * chrome entirely for a single question. Options are capped at
 * {@link MAX_OPTIONS_PER_QUESTION} because a radio group stops being one past
 * a handful.
 *
 * Layer A: imports ONLY `zod/v4` — no `node:*`, no `convex/_generated` — so it
 * is safe to import from V8 Convex code, `'use node'` actions, Bun scripts,
 * vitest, and the browser alike.
 */

import { z } from 'zod/v4';

/**
 * How many questions one set may carry. Four is the ceiling every comparable
 * assistant lands on, and it is where the form in the report started
 * scrolling — past it, the ask stops reading as a conversation.
 */
export const MAX_QUESTIONS_PER_SET = 4;

/** A choice needs at least two options, or it is not a choice. */
export const MIN_OPTIONS_PER_QUESTION = 2;

/**
 * Upper bound on the options a model may author. The client appends `Other…`
 * on top of these, so the most a person ever sees is this plus one.
 */
export const MAX_OPTIONS_PER_QUESTION = 4;

export const MAX_QUESTION_LENGTH = 300;
/**
 * The intro gets its own, larger budget. It is the one place the assistant
 * explains why it is asking — "I searched the knowledge base and found
 * nothing, so I need a few details" — and holding it to a question's length
 * rejected perfectly good sets for being informative.
 */
export const MAX_INTRO_LENGTH = 600;
export const MAX_OPTION_LABEL_LENGTH = 80;
export const MAX_OPTION_DESCRIPTION_LENGTH = 200;
export const MAX_QUESTION_HEADER_LENGTH = 12;
/** Cap on what someone types into the `Other…` field. */
export const MAX_FREE_TEXT_LENGTH = 2000;

/**
 * The reserved id of the client-injected escape hatch. It is NOT part of what
 * a model may author — {@link questionSchema} rejects an option claiming it —
 * so the free-text branch can never be confused with a real choice, and the
 * client can always find it without string-matching a translated label.
 */
export const OTHER_OPTION_ID = '__other__';

/** Ids a model may not author, because the client owns them. */
const RESERVED_OPTION_IDS: ReadonlySet<string> = new Set([OTHER_OPTION_ID]);

/**
 * A display string that is TRIMMED to its bound rather than rejected for
 * exceeding it.
 *
 * Length is a presentation concern, not a correctness one. Rejecting a whole
 * question set because its intro ran twenty characters long costs a round
 * trip, puts a red failure in the transcript, and asks the model to solve a
 * problem the client could solve by clipping a sentence. So the cosmetic
 * fields clamp and the STRUCTURAL rules — options present, counts in range,
 * labels unique — still reject, because those change what the question means.
 *
 * `label` is deliberately NOT clamped: labels are the answer values and must
 * stay unique, and two long labels could truncate into the same string.
 */
function clamped(max: number, min = 0) {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value.length > max
        ? `${value.slice(0, max - 1).trimEnd()}…`
        : value,
    z.string().min(min).max(max),
  );
}

const optionSchema = z.object({
  /**
   * What the option says. Doubles as its value: unique within its question,
   * so an answer needs no lookup table to read back.
   */
  label: z.string().min(1).max(MAX_OPTION_LABEL_LENGTH),
  /**
   * What picking this option would mean. Optional, but it is what turns a
   * list of nouns into an informed choice — prefer writing one.
   */
  description: clamped(MAX_OPTION_DESCRIPTION_LENGTH).optional(),
  /**
   * The asker's researched recommendation. Rendered as a badge ON the option
   * itself — writing "RECOMMENDED" into the description buries it below the
   * fold, where a truncated preview hides exactly the word that matters.
   * At most one option per question should carry it.
   */
  recommended: z.boolean().optional(),
});

export const questionSchema = z
  .object({
    /** Stable key the answer is filed under. Unique within the set. */
    id: z.string().min(1).max(64),
    /** The question itself — one self-contained sentence. */
    question: clamped(MAX_QUESTION_LENGTH, 1),
    /**
     * A very short label for the progress chip (`Purpose`, `Tone`). Absent
     * simply means the chip shows the step number instead.
     */
    header: clamped(MAX_QUESTION_HEADER_LENGTH, 1).optional(),
    /**
     * The choices on offer. REQUIRED — this is the whole point of the format.
     * The client appends `Other…`, so a model never needs to author one.
     */
    options: z
      .array(optionSchema)
      .min(MIN_OPTIONS_PER_QUESTION)
      .max(MAX_OPTIONS_PER_QUESTION),
    /** More than one option may be picked. Absent means single-select. */
    multiSelect: z.boolean().optional(),
  })
  .strict()
  // "At most one recommended per question" is normalized, not refused — the
  // file's clamp philosophy: a second `recommended: true` is a cosmetic
  // authoring slip, and rejecting the whole set over it would cost the model
  // a round trip. The FIRST flagged option keeps the badge (it is also the
  // one the tool text says to put first); the rest are cleared.
  .transform((question) => {
    let seen = false;
    let changed = false;
    // Annotated so the output type keeps `recommended` (the map's union of
    // with/without would otherwise erase it from the inferred type).
    const options: typeof question.options = question.options.map((option) => {
      if (option.recommended !== true) return option;
      if (!seen) {
        seen = true;
        return option;
      }
      changed = true;
      const { recommended: _dropped, ...rest } = option;
      return rest;
    });
    return changed ? { ...question, options } : question;
  })
  .refine(
    (question) =>
      new Set(question.options.map((option) => option.label)).size ===
      question.options.length,
    {
      // Labels are the values, so two identical labels would make the answer
      // ambiguous the moment it is read back.
      message: 'option labels must be unique within a question',
      path: ['options'],
    },
  )
  .refine(
    (question) =>
      !question.options.some((option) => RESERVED_OPTION_IDS.has(option.label)),
    {
      message: `"${OTHER_OPTION_ID}" is reserved for the free-text option the client adds`,
      path: ['options'],
    },
  );

export type Question = z.infer<typeof questionSchema>;

export const questionSetSchema = z
  .object({
    /**
     * The heading above the set — what the assistant is trying to settle.
     * One line; the questions carry the detail.
     */
    intro: clamped(MAX_INTRO_LENGTH).optional(),
    questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS_PER_SET),
  })
  .strict()
  .refine(
    (set) =>
      new Set(set.questions.map((question) => question.id)).size ===
      set.questions.length,
    {
      message: 'question ids must be unique within a set',
      path: ['questions'],
    },
  );

export type QuestionSet = z.infer<typeof questionSetSchema>;

/**
 * One answer. `selected` holds the option LABELS the person picked (empty
 * when they answered in their own words); `freeText` holds what they typed
 * into `Other…`. Both may be set for a multi-select where `Other…` was one of
 * several picks.
 */
export const answerSchema = z
  .object({
    questionId: z.string().min(1).max(64),
    selected: z.array(z.string().min(1).max(MAX_OPTION_LABEL_LENGTH)),
    freeText: z.string().max(MAX_FREE_TEXT_LENGTH).optional(),
  })
  .strict()
  .refine(
    (answer) =>
      answer.selected.length > 0 || (answer.freeText ?? '').trim().length > 0,
    {
      // An answer that selected nothing and typed nothing is not an answer.
      // The UI never submits one; this is the boundary saying so too.
      message: 'an answer must select an option or carry free text',
      path: ['selected'],
    },
  );

export type QuestionAnswer = z.infer<typeof answerSchema>;

/**
 * How one answer reads back to the model: the question, then what was
 * chosen. A free-text answer is marked as the person's own words so the model
 * can tell a picked option from a typed one — the difference matters when it
 * decides whether to ask again.
 */
function formatAnswerForModel(
  question: Question,
  answer: QuestionAnswer,
): string {
  const parts = [...answer.selected];
  const typed = (answer.freeText ?? '').trim();
  if (typed.length > 0) parts.push(`${typed} (in their own words)`);
  return `${question.question} → ${parts.join('; ')}`;
}

/**
 * The whole answered set, as the block appended to the conversation when the
 * turn resumes. Questions with no answer are omitted rather than reported
 * empty: the resumed model should read what it learned, not a list of gaps.
 */
export function formatAnswerSetForModel(
  set: QuestionSet,
  answers: readonly QuestionAnswer[],
): string {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  return set.questions
    .flatMap((question) => {
      const answer = byId.get(question.id);
      return answer ? [formatAnswerForModel(question, answer)] : [];
    })
    .join('\n');
}
