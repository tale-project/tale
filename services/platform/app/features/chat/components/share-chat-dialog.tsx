'use client';

/**
 * The manage-sharing dialog — the 0.3 share surface on the snapshot model:
 * a switch publishes (or takes down) the org-internal link, the live link is
 * copyable and previewable, and — new with the snapshot boundary — sharing
 * again is how the owner publishes the turns that happened since `sharedAt`.
 *
 * The status is a READ (`getThreadShareStatus`): opening the dialog never
 * publishes anything.
 */

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Check, Copy, ExternalLink, Link, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { useCopy } from '@/app/hooks/use-copy';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useChatQuery } from '../data/chat-backend';
import { useThreadSharing } from '../data/thread-sharing';

function ShareChatDialogContent({
  open,
  onOpenChange,
  threadId,
  organizationId,
}: ShareChatDialogProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const { formatDate } = useFormatDate();
  const { copied, copy } = useCopy();
  const sharing = useThreadSharing(organizationId);
  const [pending, setPending] = useState(false);

  const status = useChatQuery(api.chat.threads.getThreadShareStatus, {
    organizationId,
    threadId,
  });
  const share = status.status === 'ready' ? status.data : undefined;
  const isShared = share?.isShared === true;
  // Default to shareable while the status is still loading so the switch
  // isn't briefly disabled on a normal thread; an arena pair resolves to
  // false and disables it.
  const isShareable = share?.isShareable ?? true;
  const blockSharing = !isShareable && !isShared;

  const shareUrl =
    isShared && share?.shareToken != null
      ? `${window.location.origin}/dashboard/${organizationId}/chat/shared/${share.shareToken}`
      : '';

  const publish = async () => {
    setPending(true);
    try {
      const token = await sharing.share(threadId);
      if (token === null) {
        toast({
          title: t(
            isShareable ? 'share.shareFailed' : 'share.cannotShareArena',
          ),
          variant: 'destructive',
        });
      }
    } finally {
      setPending(false);
    }
  };

  const handleToggle = (checked: boolean) => {
    if (checked) {
      void publish();
      return;
    }
    setPending(true);
    void sharing
      .unshare(threadId)
      .then((ok) => {
        if (!ok) {
          toast({ title: t('share.unshareFailed'), variant: 'destructive' });
        }
      })
      .finally(() => setPending(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title')}
      description={t('share.description')}
      icon={<Link className="text-muted-foreground size-5" />}
      size="md"
    >
      <Stack className="min-w-0 overflow-hidden">
        <Switch
          label={t('share.enableSharing')}
          description={t('share.enableSharingDescription')}
          checked={isShared}
          onCheckedChange={handleToggle}
          disabled={pending || blockSharing}
        />

        {blockSharing && (
          <Text variant="muted" className="text-xs">
            {t('share.notShareable')}
          </Text>
        )}

        {isShared && shareUrl.length > 0 && (
          <Stack gap={2} className="min-w-0">
            <Text variant="label" className="text-sm">
              {t('share.linkLabel')}
            </Text>
            <div className="bg-background border-border min-w-0 overflow-hidden rounded-lg border p-2">
              <Text
                variant="muted"
                className="block overflow-hidden text-xs text-ellipsis whitespace-nowrap"
              >
                {shareUrl}
              </Text>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="secondary"
                onClick={() => void copy(shareUrl)}
                className="gap-1.5"
                aria-label={t('share.copyLink')}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? t('share.copied') : t('share.copyLink')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void publish()}
                disabled={pending}
                className="gap-1.5"
                aria-label={t('share.republish')}
              >
                <RefreshCw className="size-3.5" />
                {t('share.republish')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({
                    to: '/dashboard/$id/chat/shared/$shareToken',
                    params: {
                      id: organizationId,
                      shareToken: share?.shareToken ?? '',
                    },
                  });
                }}
                className="gap-1.5"
                aria-label={t('share.preview')}
              >
                <ExternalLink className="size-3.5" />
                {t('share.preview')}
              </Button>
            </div>
            {/* The snapshot boundary: turns after `sharedAt` stay private
                until the owner publishes again. */}
            <Text variant="muted" className="text-xs">
              {share?.sharedAt != null
                ? t('share.sharedAsOf', {
                    date: formatDate(new Date(share.sharedAt), 'long'),
                  })
                : t('share.linkHint')}
            </Text>
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
}

interface ShareChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  organizationId: string;
}

/** Mounted only while open — the status read starts with the dialog. */
export function ShareChatDialog(props: ShareChatDialogProps) {
  if (!props.open) return null;
  return <ShareChatDialogContent {...props} />;
}
