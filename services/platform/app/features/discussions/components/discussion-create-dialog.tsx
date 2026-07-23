'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_DISCUSSION_CATEGORIES,
  DEFAULT_DISCUSSION_CATEGORY,
  type DiscussionCategory,
} from '@/lib/shared/constants/discussions';
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';
import { cn } from '@/lib/utils/cn';

import { useCreateDiscussion } from '../hooks/mutations';

interface DiscussionCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: Id<'projects'>;
  onCreated: (threadId: string) => void;
}

export function DiscussionCreateDialog({
  open,
  onOpenChange,
  organizationId,
  projectId,
  onCreated,
}: DiscussionCreateDialogProps) {
  const { t } = useT('discussions');
  const { t: tCommon } = useT('common');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DiscussionCategory>(
    DEFAULT_DISCUSSION_CATEGORY,
  );
  const [body, setBody] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);

  const { mutateAsync: createDiscussion } = useCreateDiscussion();

  const reset = () => {
    setTitle('');
    setCategory(DEFAULT_DISCUSSION_CATEGORY);
    setBody('');
    setTitleError(undefined);
  };

  const handleCreate = async (message: string) => {
    if (isCreating) return;
    if (!title.trim()) {
      setTitleError(t('create.titleRequired'));
      return;
    }
    if (!message.trim()) return;
    setTitleError(undefined);
    setIsCreating(true);
    try {
      const result = await createDiscussion({
        organizationId,
        projectId,
        title: title.trim(),
        message,
        category,
      });
      toastUnresolvedMentions(result.unresolvedMentionTokens, toast, tCommon);
      reset();
      onCreated(result.threadId);
    } catch (error) {
      console.error('Failed to create discussion', error);
      toast({ title: t('create.failed'), variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('create.title')}
      size="lg"
    >
      <Stack gap={4}>
        <Input
          label={t('create.titleLabel')}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError(undefined);
          }}
          placeholder={t('create.titlePlaceholder')}
          errorMessage={titleError}
          required
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('create.category')}</span>
          <Row gap={2} align="stretch" wrap>
            {DEFAULT_DISCUSSION_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  category === c
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                {t(`categories.${c}`)}
              </button>
            ))}
          </Row>
        </div>
        {/* A plain textarea stands in for the chat composer (rich mentions,
            attachments) while the chat backend is rebuilt — `@handle`
            mentions typed as text are still parsed server-side. */}
        <Textarea
          aria-label={t('create.bodyPlaceholder')}
          placeholder={t('create.bodyPlaceholder')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
        />
        <p className="text-muted-foreground text-xs">{t('create.hint')}</p>
        <Row gap={2} align="stretch" justify="end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('create.cancel')}
          </Button>
          <Button
            onClick={() => void handleCreate(body)}
            disabled={isCreating || !body.trim() || !title.trim()}
          >
            {t('create.title')}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
