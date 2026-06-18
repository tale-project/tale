'use client';

/** `review` — the human-actionable kind: a gate/form/choice a person resolves,
 * resuming the run with structured output. When the step's output carries a
 * bound `taskId`, we mount the existing task review card (the real approve /
 * request-changes affordance); otherwise we surface the pending decision. */
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { TaskReviewCard } from '@/app/features/tasks/components/task-review-card';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import type { ReviewMode } from '@/lib/shared/platform/render_kinds';

import { asRecord, pickString } from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { OutputFallback } from '../output-fallback';

function resolveMode(value: string | undefined): ReviewMode {
  if (value === 'gate' || value === 'form' || value === 'choice') return value;
  return 'gate';
}

export function ReviewPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const out = asRecord(step.output);
  const taskId = pickString(out, 'taskId');
  const mode = resolveMode(step.params?.mode);

  if (taskId) {
    return <TaskReviewCard taskId={toId<'tasks'>(taskId)} />;
  }

  const question = pickString(out, 'question', 'prompt', 'summary');
  return (
    <VStack gap={1}>
      <Text as="span" variant="muted">
        {t(`review.${mode}`)}
      </Text>
      {question !== undefined ? (
        <Text as="div" className="whitespace-pre-wrap">
          {question}
        </Text>
      ) : (
        <OutputFallback step={step} />
      )}
    </VStack>
  );
}
