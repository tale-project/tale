'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { MessageCircleQuestion } from 'lucide-react';
import { useId, useState } from 'react';

import { QuestionFlow } from '@/app/components/ui/forms/question-flow';
import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import {
  formatAnswerSetForModel,
  type QuestionAnswer,
  type QuestionSet,
} from '@/lib/shared/schemas/questions';

import { useAnswerHumanAsk } from '../hooks/mutations';
import { automationErrorMessage } from '../lib/errors';

/** The pending-ask shape `getPendingAskForRun` returns — the caller queries
 * it (the panel also drives its state line from it) and hands it in. */
export interface RunPendingAsk {
  askId: string;
  question: string;
  /** Present when the agent offered choices — the operator then gets the same
   *  one-question-at-a-time flow the chat composer shows, instead of a box. */
  questions?: QuestionSet;
}

/**
 * The answer surface of a run whose agent asked a question and parked: the
 * question, one answer box, one submit. Submitting records the answer and
 * resumes the SAME agent conversation — the card clears reactively when the
 * pending ask flips to answered. `onAnswerPosted` lets the task panel mirror
 * the answer onto the task timeline as the member's own comment BEFORE the
 * resume kicks (post-then-run, so the resumed agent can already read it).
 */
export function RunAskCard({
  organizationId,
  ask,
  onAnswerPosted,
}: {
  organizationId: string;
  ask: RunPendingAsk;
  onAnswerPosted?: (answer: string) => Promise<void>;
}) {
  const { t } = useT('automations');
  const answerAsk = useAnswerHumanAsk();
  const inputId = useId();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const submitText = async (raw: string) => {
    const text = raw.trim();
    if (text === '') return;
    setBusy(true);
    setRefusal(null);
    try {
      // Timeline first, resume second — a mirror that fails must not block
      // the answer, so it only warns.
      if (onAnswerPosted !== undefined) {
        await onAnswerPosted(text).catch((error: unknown) => {
          console.warn('[automations] answer comment mirror failed:', error);
        });
      }
      await answerAsk.mutateAsync({
        organizationId,
        askId: ask.askId,
        answer: text,
      });
    } catch (error) {
      setRefusal(automationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => submitText(answer);

  /* Choices offered: the shared flow, minus the two affordances that only
     make sense in chat. There is no composer on this lane to hand back to,
     and nothing to collapse to — the card IS the surface, so the question
     cannot be dismissed out of the way here. */
  const questionSet = ask.questions;
  if (questionSet !== undefined) {
    return (
      <div className="border-primary/40 bg-primary/[0.03] flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-start gap-2">
          <MessageCircleQuestion
            className="text-primary mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          <Text as="p" className="text-sm font-medium">
            {t('runs.ask.title')}
          </Text>
        </div>
        <QuestionFlow
          set={questionSet}
          busy={busy}
          error={refusal}
          onSubmit={(answers: QuestionAnswer[]) =>
            submitText(formatAnswerSetForModel(questionSet, answers))
          }
        />
      </div>
    );
  }

  return (
    <div className="border-primary/40 bg-primary/[0.03] flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <MessageCircleQuestion
          className="text-primary mt-0.5 size-4 shrink-0"
          aria-hidden
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Text as="p" className="text-sm font-medium">
            {t('runs.ask.title')}
          </Text>
          {/* Agent questions arrive as prose with lists/options/amounts —
              render them as Markdown so a structured ask reads as one. */}
          <div data-testid="run-ask-question">
            <MarkdownContent content={ask.question} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t('runs.ask.answerLabel')}
        </label>
        <Textarea
          id={inputId}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={t('runs.ask.placeholder')}
          rows={3}
          disabled={busy}
          className="bg-background"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            isLoading={busy}
            disabled={answer.trim() === ''}
            onClick={() => void submit()}
          >
            {t('runs.ask.submit')}
          </Button>
        </div>
      </div>
      {refusal !== null && (
        <Alert variant="destructive" description={refusal} />
      )}
    </div>
  );
}
