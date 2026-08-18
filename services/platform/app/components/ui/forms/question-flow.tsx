'use client';

/**
 * The clarifying-question flow — one question at a time, options first.
 *
 * Both lanes that ask a person something mid-turn render THIS component: the
 * chat composer anchors it in the input frame, and an automation run mounts it
 * inline on its card. One copy, because a divergent second one is how the two
 * surfaces drift apart.
 *
 * What it is deliberately not: a form. The shape it replaced stacked every
 * field at once, each a blank textarea, inside a card in the transcript — so
 * the reader had to scroll back to find it and then compose four answers
 * before anything happened. Here exactly one question is on screen, its
 * choices are already written, and answering advances.
 *
 * Three rules earn their complexity:
 *
 *  - **A single question gets no progress chrome.** Stepping one question is
 *    pure overhead; the counter, the dots and Back only appear from two up.
 *  - **Picking advances, and the flow says so first** (`autoAdvanceHint`).
 *    Auto-advance is a change of context on input (WCAG 3.2.2), which is
 *    permitted when the reader was told beforehand — so they are, and Back is
 *    always there to undo it.
 *  - **Nothing here traps.** There is no focus trap and no `aria-modal`: Esc
 *    collapses, Tab leaves, and simply saying something else in the composer
 *    retires the question. A person who wants to move on always wins.
 *
 * `Other…` is injected here rather than by the model, so it is always offered,
 * always last, and always in the reader's language. That it is UNCONDITIONAL
 * is load-bearing: it is why there is no separate "type instead" affordance —
 * every question already has a way to answer in your own words.
 */

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  MAX_FREE_TEXT_LENGTH,
  OTHER_OPTION_ID,
  type Question,
  type QuestionAnswer,
  type QuestionSet,
} from '@/lib/shared/schemas/questions';
import { cn } from '@/lib/utils/cn';

/** What the flow holds per question while it is being answered. */
interface DraftAnswer {
  /** Option labels picked so far. */
  selected: string[];
  /** Whether the injected `Other…` choice is active. */
  other: boolean;
  freeText: string;
}

const EMPTY_DRAFT: DraftAnswer = { selected: [], other: false, freeText: '' };

export interface QuestionFlowProps {
  set: QuestionSet;
  /** Called once, with every answered question, when the last one settles. */
  onSubmit: (answers: QuestionAnswer[]) => void | Promise<void>;
  /**
   * Give up on the question. FINAL — it is retired and the composer comes
   * back. Named for what it does: "Answer later" promised a later that
   * almost never existed, because the only reason to leave the panel is to
   * reach the composer, and typing retires the question anyway.
   */
  onSkip?: () => void;
  /** Collapse out of the way WITHOUT deciding anything (Esc). Recoverable —
   *  a habitual keypress must never discard an answer in progress. */
  onCollapse?: () => void;
  busy?: boolean;
  error?: string | null;
  className?: string;
}

/** A draft is answerable once something is picked, or something is typed. */
function isAnswered(draft: DraftAnswer): boolean {
  if (draft.other) return draft.freeText.trim().length > 0;
  return draft.selected.length > 0;
}

function toAnswer(question: Question, draft: DraftAnswer): QuestionAnswer {
  const typed = draft.freeText.trim();
  return {
    questionId: question.id,
    selected: draft.selected,
    ...(draft.other && typed.length > 0 ? { freeText: typed } : {}),
  };
}

export function QuestionFlow({
  set,
  onSubmit,
  onSkip,
  onCollapse,
  busy = false,
  error = null,
  className,
}: QuestionFlowProps) {
  const { t } = useT('questions');
  const headingId = useId();
  const hintId = useId();
  const [cursor, setCursor] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const freeTextRef = useRef<HTMLTextAreaElement | null>(null);

  const total = set.questions.length;
  const stepped = total > 1;
  const question = set.questions[cursor];
  const draft = drafts[question?.id ?? ''] ?? EMPTY_DRAFT;
  const answered = isAnswered(draft);
  const isLast = cursor === total - 1;

  const patch = useCallback((id: string, next: Partial<DraftAnswer>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? EMPTY_DRAFT), ...next },
    }));
  }, []);

  /** Collect every answered question and hand the whole set over at once —
   *  one submission, one resume, however many questions were asked. */
  const submitAll = useCallback(
    (finalDrafts: Record<string, DraftAnswer>) => {
      const answers = set.questions.flatMap((entry) => {
        const entryDraft = finalDrafts[entry.id];
        return entryDraft && isAnswered(entryDraft)
          ? [toAnswer(entry, entryDraft)]
          : [];
      });
      if (answers.length === 0) return;
      void onSubmit(answers);
    },
    [onSubmit, set.questions],
  );

  const advance = useCallback(
    (finalDrafts: Record<string, DraftAnswer>) => {
      if (isLast) {
        submitAll(finalDrafts);
        return;
      }
      setCursor((current) => Math.min(current + 1, total - 1));
    },
    [isLast, submitAll, total],
  );

  // Focus follows the question so a keyboard reader lands on the new choices
  // rather than being left where the previous question's option used to be.
  useEffect(() => {
    if (busy) return;
    // Radix radio items carry an explicit role; the multi-select rows are
    // native inputs whose checkbox role is implicit, so both spellings.
    const first = optionsRef.current?.querySelector<HTMLElement>(
      '[role="radio"],input[type="checkbox"]',
    );
    first?.focus();
  }, [cursor, busy]);

  // Esc collapses rather than cancels: the question is still pending, the
  // reader just wants the input back. Bound on the panel, not the document,
  // so it never steals Esc from a dialog above it.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && onCollapse) {
      event.stopPropagation();
      onCollapse();
    }
  };

  if (!question) return null;

  const pickSingle = (label: string) => {
    const isOther = label === OTHER_OPTION_ID;
    const next: DraftAnswer = isOther
      ? { selected: [], other: true, freeText: draft.freeText }
      : { selected: [label], other: false, freeText: '' };
    const merged = { ...drafts, [question.id]: next };
    setDrafts(merged);
    // Choosing `Other…` opens a text field instead of moving on — there is
    // nothing to advance to until something is typed.
    if (isOther) {
      window.setTimeout(() => freeTextRef.current?.focus(), 0);
      return;
    }
    advance(merged);
  };

  const toggleMulti = (label: string) => {
    const isOther = label === OTHER_OPTION_ID;
    if (isOther) {
      patch(question.id, { other: !draft.other });
      if (!draft.other)
        window.setTimeout(() => freeTextRef.current?.focus(), 0);
      return;
    }
    const selected = draft.selected.includes(label)
      ? draft.selected.filter((entry) => entry !== label)
      : [...draft.selected, label];
    patch(question.id, { selected });
  };

  const onNext = () => {
    if (!answered) return;
    advance(drafts);
  };

  const multi = question.multiSelect === true;
  const choices = [
    ...question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
      recommended: option.recommended === true,
    })),
    {
      value: OTHER_OPTION_ID,
      label: t('otherOption'),
      description: undefined,
      recommended: false,
    },
  ];

  const optionClasses = (active: boolean) =>
    cn(
      // Compact rows, not cards. Four stacked cards with descriptions turned
      // the input area into a full-height form; this keeps the whole set in
      // roughly the footprint the composer occupied. Still well past the 24px
      // minimum target size.
      'flex w-full min-h-9 cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
      // The multi-select row is a <label> around a visually hidden input, so
      // the ring has to come from the input's focus, not the row's.
      'has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-1',
      active
        ? 'border-primary bg-primary/5'
        : 'border-border hover:bg-muted/50 bg-transparent',
    );

  /** Selection is never colour alone (WCAG 1.4.1) — a checkmark carries it. */
  const marker = (active: boolean) => (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
        multi ? 'rounded-[4px]' : 'rounded-full',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border',
      )}
    >
      {active && <Check className="size-3" />}
    </span>
  );

  const body = (
    <div ref={optionsRef} className="flex flex-col gap-1">
      {choices.map((choice) => {
        const active =
          choice.value === OTHER_OPTION_ID
            ? draft.other
            : draft.selected.includes(choice.value);
        const content = (
          <>
            {marker(active)}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <Text as="span" className="text-sm leading-snug">
                  {choice.label}
                </Text>
                {/* The asker's recommendation rides the ANSWER, not the
                    description — a truncated preview must never hide it. */}
                {choice.recommended && (
                  <span className="bg-primary/10 text-primary rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide uppercase">
                    {t('recommended')}
                  </span>
                )}
              </span>
              {choice.description !== undefined && (
                <Text
                  as="span"
                  variant="muted"
                  className="text-xs leading-snug"
                >
                  {choice.description}
                </Text>
              )}
            </span>
          </>
        );
        return multi ? (
          // A real checkbox, visually hidden behind the styled row: native
          // semantics and native keyboard beat any re-implementation, and the
          // focus ring rides the row through `has-[:focus-visible]`.
          <label key={choice.value} className={optionClasses(active)}>
            <input
              type="checkbox"
              className="sr-only"
              checked={active}
              disabled={busy}
              onChange={() => toggleMulti(choice.value)}
            />
            {content}
          </label>
        ) : (
          <RadioGroupPrimitive.Item
            key={choice.value}
            value={choice.value}
            disabled={busy}
            className={optionClasses(active)}
          >
            {content}
          </RadioGroupPrimitive.Item>
        );
      })}
    </div>
  );

  return (
    // A group labelled by the question it is asking. NOT `aria-modal` and not
    // focus-trapped on purpose: Esc collapses, Tab leaves, and the reader can
    // always go somewhere else.
    <div
      role="group"
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className={cn(
        // The composer's own frame, to the pixel: same width cap, centring,
        // border, radius and lifted shadow. For as long as it is up, this IS
        // the input area — a panel that spans wider than the box it replaces
        // reads as a form dropped over the page instead of as the place you
        // answer. Kept in sync with `composer.tsx`.
        'border-border sm:border-muted-foreground/50 bg-background relative mx-auto w-full max-w-3xl rounded-xl border px-3 py-3 shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.15)] sm:rounded-2xl sm:px-5 sm:py-4 dark:shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.5)]',
        className,
      )}
    >
      {stepped && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {/* ONE progress element, both seen and announced (WCAG 4.1.3). A
              separate sr-only copy would make assistive tech read the step
              twice on every advance — once from the live region, once from
              the visible chip. The dots stay decorative. */}
          <Text
            variant="muted"
            className="text-xs"
            role="status"
            aria-live="polite"
            aria-label={t('regionLabel')}
          >
            {t('progress', { current: cursor + 1, total })}
          </Text>
          <div className="flex items-center gap-1" aria-hidden>
            {set.questions.map((entry, index) => (
              <span
                key={entry.id}
                className={cn(
                  'size-1.5 rounded-full',
                  index === cursor
                    ? 'bg-primary'
                    : index < cursor
                      ? 'bg-primary/40'
                      : 'bg-border',
                )}
              />
            ))}
          </div>
        </div>
      )}

      {set.intro !== undefined && cursor === 0 && (
        <Text variant="muted" className="mb-1 text-xs leading-snug">
          {set.intro}
        </Text>
      )}

      <Text as="p" id={headingId} className="mb-1.5 text-sm font-medium">
        {question.question}
      </Text>

      {multi ? (
        // No second grouping role — the panel above already is one, labelled
        // by this same question; nesting another would make AT announce the
        // question twice.
        <div aria-describedby={hintId}>{body}</div>
      ) : (
        <RadioGroupPrimitive.Root
          value={draft.other ? OTHER_OPTION_ID : (draft.selected[0] ?? '')}
          onValueChange={pickSingle}
          aria-labelledby={headingId}
          aria-describedby={hintId}
          disabled={busy}
        >
          {body}
        </RadioGroupPrimitive.Root>
      )}

      {draft.other && (
        <div className="mt-2">
          <label htmlFor={`${headingId}-other`} className="sr-only">
            {t('otherLabel')}
          </label>
          <Textarea
            id={`${headingId}-other`}
            ref={freeTextRef}
            rows={2}
            maxLength={MAX_FREE_TEXT_LENGTH}
            value={draft.freeText}
            disabled={busy}
            placeholder={t('otherPlaceholder')}
            onChange={(event) =>
              patch(question.id, { freeText: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && answered) {
                event.preventDefault();
                onNext();
              }
            }}
          />
        </div>
      )}

      <Text id={hintId} variant="muted" className="mt-1.5 text-xs">
        {multi ? t('multiSelectHint') : t('autoAdvanceHint')}
      </Text>

      {error !== null && (
        <Alert variant="destructive" description={error} className="mt-2" />
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {/* No "Type instead" here. Answering in your own words is what
            `Other…` is for, and it is on EVERY question — the client appends
            it, so it can never be missing. That left the button meaning only
            "abandon the set", which sending a message already says. */}
        <div className="flex items-center gap-1">
          {onSkip && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
              {t('skip')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {stepped && cursor > 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setCursor((current) => Math.max(current - 1, 0))}
            >
              {t('back')}
            </Button>
          )}
          {/* Single-select advances on pick, so Next stays out of the way on
              a question that has not been answered yet.
              It MUST appear once one has been: going Back to an answered
              single-select otherwise stranded the reader, because re-clicking
              the option they already chose does not change the radio's value
              and so fires no change at all. Back was a one-way trip. */}
          {(multi || draft.other || answered) && (
            <Button
              size="sm"
              isLoading={busy}
              disabled={!answered}
              onClick={onNext}
            >
              {isLast ? (total > 1 ? t('submit') : t('submitOne')) : t('next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
