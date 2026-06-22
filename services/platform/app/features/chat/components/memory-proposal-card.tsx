'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { Row } from '@tale/ui/layout';
import { useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  useApprovePendingMemory,
  useDismissPendingMemory,
} from '@/app/features/settings/personalization/hooks/mutations';
import { useToast } from '@/app/hooks/use-toast';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { convexErrorMessage } from '@/lib/utils/convex-error';

const CARD_TEXTAREA_MAX = 800;

interface MemoryProposalCardProps {
  memory: Doc<'userMemories'>;
}

export function MemoryProposalCard({ memory }: MemoryProposalCardProps) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: approve } = useApprovePendingMemory();
  const { mutateAsync: dismiss } = useDismissPendingMemory();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);

  const handleApprove = async (content?: string) => {
    try {
      await (content !== undefined
        ? approve({ memoryId: memory._id, content })
        : approve({ memoryId: memory._id }));
      toast({ title: t('toasts.saved') });
    } catch (err) {
      toast({
        title: convexErrorMessage(err, t('errors.saveFailed')),
        variant: 'destructive',
      });
    }
  };

  const handleDismiss = async () => {
    try {
      await dismiss({ memoryId: memory._id });
      toast({ title: t('toasts.discarded') });
    } catch (err) {
      toast({
        title: convexErrorMessage(err, t('errors.saveFailed')),
        variant: 'destructive',
      });
    }
  };

  return (
    <Card padding="sm">
      <div className="text-fg-muted mb-1 text-xs font-medium">
        💡 {t('card.label')}
      </div>
      {editing ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={CARD_TEXTAREA_MAX}
          className="mb-2"
        />
      ) : (
        <p className="mb-2 text-sm">{memory.content}</p>
      )}
      <Row gap={2} align="stretch" justify="end">
        {editing ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setDraft(memory.content);
              }}
            >
              {t('card.discard')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!draft.trim() || draft === memory.content}
              onClick={() => handleApprove(draft)}
            >
              {t('card.save')}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              {t('card.discard')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
            >
              {t('card.edit')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => handleApprove()}>
              {t('card.save')}
            </Button>
          </>
        )}
      </Row>
    </Card>
  );
}
