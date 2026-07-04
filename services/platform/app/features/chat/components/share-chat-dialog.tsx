'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Check, Copy, ExternalLink, Link } from 'lucide-react';
import { useCallback, useState, useRef, useEffect } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { convexErrorCode } from '@/lib/utils/convex-error';

import { useShareThread, useUnshareThread } from '../hooks/mutations';

interface ShareChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId: string;
  organizationId: string;
}

function ShareChatDialogContent({
  open,
  onOpenChange,
  threadId,
  organizationId,
}: ShareChatDialogProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { data: shareStatus } = useConvexQuery(
    api.threads.queries.getThreadShareStatus,
    { threadId, organizationId },
  );

  const { mutate: shareThread, isPending: isSharing } = useShareThread();
  const { mutate: unshareThread, isPending: isUnsharing } = useUnshareThread();

  const isShared = shareStatus?.isShared ?? false;
  const shareToken = shareStatus?.shareToken ?? null;
  // Default to shareable while the status query is still loading so the toggle
  // isn't briefly disabled on a normal thread. Arena/branch/archived threads
  // resolve to `false` and disable sharing (#2086).
  const isShareable = shareStatus?.isShareable ?? true;
  const blockSharing = !isShareable && !isShared;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const shareUrl = shareToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard/${organizationId}/chat/shared/${shareToken}`
    : '';

  const handleToggleShare = useCallback(
    (checked: boolean) => {
      if (checked) {
        shareThread(
          { threadId, organizationId },
          {
            onError: (error) => {
              // The backend raises a structured ConvexError for the reasons a
              // share is refused; map each to an actionable message instead of
              // the generic "Failed to share chat" (#2086). Unknown codes and
              // raw errors fall back to the generic copy.
              const byCode: Record<string, string> = {
                CANNOT_SHARE_ARENA_THREAD: t('share.cannotShareArena'),
                CANNOT_SHARE_BRANCH_THREAD: t('share.cannotShareBranch'),
                THREAD_ARCHIVED: t('share.cannotShareArchived'),
              };
              const code = convexErrorCode(error);
              toast({
                title: (code && byCode[code]) || t('share.shareFailed'),
                variant: 'destructive',
              });
            },
          },
        );
      } else {
        unshareThread(
          { threadId },
          {
            onError: () => {
              toast({
                title: t('share.unshareFailed'),
                variant: 'destructive',
              });
            },
          },
        );
      }
    },
    [threadId, organizationId, shareThread, unshareThread, toast, t],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch {
      toast({
        title: t('share.copyFailed'),
        variant: 'destructive',
      });
    }
  }, [shareUrl, toast, t]);

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
          onCheckedChange={handleToggleShare}
          disabled={isSharing || isUnsharing || blockSharing}
        />

        {blockSharing && (
          <Text variant="muted" className="text-xs">
            {t('share.notShareable')}
          </Text>
        )}

        {isShared && shareToken && (
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
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                onClick={handleCopy}
                className="gap-1.5"
                aria-label={t('share.copyLink')}
              >
                {isCopied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {isCopied ? t('share.copied') : t('share.copyLink')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  onOpenChange(false);
                  void navigate({
                    to: '/dashboard/$id/chat/shared/$shareToken',
                    params: {
                      id: organizationId,
                      shareToken: shareToken,
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
            <Text variant="muted" className="text-xs">
              {t('share.linkHint')}
            </Text>
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
}

export function ShareChatDialog(props: ShareChatDialogProps) {
  if (!props.open) return null;
  return <ShareChatDialogContent {...props} />;
}
