'use client';

import { useState, useCallback } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useArenaMode } from './arena-mode-context';

interface ArenaVerdictBarProps {
  threadIdA: string;
  threadIdB: string;
  organizationId: string;
}

type Verdict = 'a_better' | 'b_better' | 'tie' | 'both_bad';

export function ArenaVerdictBar({
  threadIdA,
  threadIdB,
  organizationId,
}: ArenaVerdictBarProps) {
  const { t } = useT('chat');
  const { modelA, modelB } = useArenaMode();
  const [selectedVerdict, setSelectedVerdict] = useState<Verdict | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: submitFeedback } = useConvexMutation(
    api.feedback.mutations.submitFeedback,
  );
  const { mutateAsync: updateBranchSelections } = useConvexMutation(
    api.threads.mutations.updateBranchSelections,
  );

  const handleVerdict = useCallback(
    async (verdict: Verdict) => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      try {
        const rating = verdict === 'both_bad' ? 'negative' : 'positive';
        const messageId = `arena:${threadIdA}:${threadIdB}`;

        await submitFeedback({
          organizationId,
          threadId: threadIdA,
          messageId,
          rating,
          metadata: {
            arenaVerdict: verdict,
            modelA: modelA ?? undefined,
            modelB: modelB ?? undefined,
          },
        });

        // If B is better, switch the branch selection so Thread B becomes active
        if (verdict === 'b_better') {
          await updateBranchSelections({
            threadId: threadIdA,
            branchSelections: JSON.stringify({ '0': threadIdB }),
          });
        }

        setSelectedVerdict(verdict);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      submitFeedback,
      updateBranchSelections,
      organizationId,
      threadIdA,
      threadIdB,
      modelA,
      modelB,
    ],
  );

  const verdicts: { key: Verdict; label: string }[] = [
    { key: 'a_better', label: t('arena.aBetter') },
    { key: 'b_better', label: t('arena.bBetter') },
    { key: 'tie', label: t('arena.tie') },
    { key: 'both_bad', label: t('arena.bothBad') },
  ];

  return (
    <div
      className="border-border flex items-center justify-center gap-2 border-t px-4 py-3"
      role="group"
      aria-label={t('arena.verdictLabel')}
    >
      {verdicts.map(({ key, label }) => (
        <Button
          key={key}
          variant={selectedVerdict === key ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => void handleVerdict(key)}
          disabled={isSubmitting || selectedVerdict !== null}
          className={cn(
            selectedVerdict === key && 'pointer-events-none',
            selectedVerdict !== null && selectedVerdict !== key && 'opacity-50',
          )}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
