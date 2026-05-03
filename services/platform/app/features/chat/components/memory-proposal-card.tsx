'use client';

import { ConvexError } from 'convex/values';
import { useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import {
  useApprovePendingMemory,
  useDismissPendingMemory,
} from '@/app/features/settings/personalization/hooks/mutations';
import { useToast } from '@/app/hooks/use-toast';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

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
        title: errorMessage(err, t('errors.saveFailed')),
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
        title: errorMessage(err, t('errors.saveFailed')),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="bg-card rounded-md border p-3">
      <div className="text-muted-foreground mb-1 text-xs font-medium">
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
      <div className="flex justify-end gap-2">
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
      </div>
    </div>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data = err.data;
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
    ) {
      return (data as { message: string }).message;
    }
  }
  return fallback;
}
