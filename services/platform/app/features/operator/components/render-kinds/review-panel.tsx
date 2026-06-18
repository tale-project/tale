'use client';

/** `review` — the human-actionable kind: a gate/form/choice a person resolves.
 * Handles both cardinalities: a queue (data.items[] of pending reviews, from the
 * approval_queue source) renders one card per item; a single review (data with a
 * bound taskId, from a workflow step's review gate) renders the one card. When a
 * task id is present we mount the real TaskReviewCard (approve / request-changes);
 * otherwise we surface the pending question. */
import { Badge } from '@tale/ui/badge';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { TaskReviewCard } from '@/app/features/tasks/components/task-review-card';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import type { ReviewMode } from '@/lib/shared/platform/render_kinds';

import { asRecord, pickArray, pickString } from '../../lib/output-helpers';
import type { RenderPart } from '../../types';
import { OutputFallback } from '../output-fallback';

function resolveMode(value: string | undefined): ReviewMode {
  if (value === 'gate' || value === 'form' || value === 'choice') return value;
  return 'gate';
}

export function ReviewPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const out = asRecord(part.data);
  const items = pickArray(out, 'items');

  // Queue (cardinality many) — one card/row per pending review.
  if (items.length > 0) {
    return (
      <VStack gap={3}>
        {items.map((raw, i) => {
          const item = asRecord(raw);
          const taskId = pickString(item, 'taskId');
          if (taskId) {
            return (
              <TaskReviewCard key={taskId} taskId={toId<'tasks'>(taskId)} />
            );
          }
          // Non-task approval — a clean labeled row, not a raw dump.
          const kind = (pickString(item, 'kind') ?? 'review').replace(
            /_/g,
            ' ',
          );
          const label = pickString(item, 'label');
          return (
            <HStack
              key={pickString(item, 'id') ?? i}
              gap={3}
              className="items-center rounded-md border p-3"
            >
              <Badge variant="yellow">{kind}</Badge>
              <Text as="span" className="min-w-0 flex-1" truncate>
                {label ?? t('review.gate')}
              </Text>
            </HStack>
          );
        })}
      </VStack>
    );
  }

  // Single (cardinality one) — a workflow step's review gate.
  const taskId = pickString(out, 'taskId');
  if (taskId) {
    return <TaskReviewCard taskId={toId<'tasks'>(taskId)} />;
  }
  const mode = resolveMode(part.params?.mode);
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
        <OutputFallback part={part} />
      )}
    </VStack>
  );
}
