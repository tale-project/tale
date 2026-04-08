'use client';

import { useNavigate } from '@tanstack/react-router';
import { GitFork, ArrowLeft } from 'lucide-react';
import { useCallback } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useForkThread } from '../hooks/mutations';
import { MessageBubble } from './message-bubble';

interface SharedChatViewProps {
  organizationId: string;
  shareToken: string;
}

export function SharedChatView({
  organizationId,
  shareToken,
}: SharedChatViewProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: sharedThread, isLoading } = useConvexQuery(
    api.threads.queries.getSharedThread,
    { shareToken },
  );

  const { mutate: forkThread, isPending: isForking } = useForkThread();

  const handleFork = useCallback(() => {
    forkThread(
      { shareToken },
      {
        onSuccess: (newThreadId) => {
          void navigate({
            to: '/dashboard/$id/chat/$threadId',
            params: { id: organizationId, threadId: newThreadId },
          });
          toast({
            title: t('share.forkSuccess'),
          });
        },
        onError: () => {
          toast({
            title: t('share.forkFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [forkThread, shareToken, navigate, organizationId, toast, t]);

  const handleBack = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
    });
  }, [navigate, organizationId]);

  if (isLoading) {
    return null;
  }

  if (!sharedThread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <Text variant="muted">{t('share.notFound')}</Text>
        <Button variant="secondary" onClick={handleBack}>
          <ArrowLeft className="mr-2 size-4" />
          {t('share.backToChat')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label={t('share.backToChat')}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <Heading level={4}>
              {sharedThread.title ?? t('history.untitled')}
            </Heading>
            <Text variant="muted" className="text-xs">
              {t('share.sharedChat')}
            </Text>
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={handleFork}
          disabled={isForking}
          className="gap-2"
        >
          <GitFork className="size-4" />
          {t('share.forkChat')}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto max-w-(--chat-max-width) space-y-4">
          {sharedThread.messages.map((message) => (
            <MessageBubble
              key={message._id}
              message={{
                id: message._id,
                role: message.role,
                content: message.content,
                timestamp: new Date(message._creationTime),
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
