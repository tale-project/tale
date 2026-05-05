'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { Check, Copy, ExternalLink, Link } from 'lucide-react';
import { useCallback, useState, useRef, useEffect } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { Text } from '@/app/components/ui/typography/text';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

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
    { threadId },
  );

  const { mutate: shareThread, isPending: isSharing } = useShareThread();
  const { mutate: unshareThread, isPending: isUnsharing } = useUnshareThread();

  const isShared = shareStatus?.isShared ?? false;
  const shareToken = shareStatus?.shareToken ?? null;

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
            onError: () => {
              toast({
                title: t('share.shareFailed'),
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
      <div className="flex min-w-0 flex-col gap-4 overflow-hidden">
        <Switch
          label={t('share.enableSharing')}
          description={t('share.enableSharingDescription')}
          checked={isShared}
          onCheckedChange={handleToggleShare}
          disabled={isSharing || isUnsharing}
        />

        {isShared && shareToken && (
          <div className="flex min-w-0 flex-col gap-2">
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
                size="sm"
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
                size="sm"
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
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function ShareChatDialog(props: ShareChatDialogProps) {
  if (!props.open) return null;
  return <ShareChatDialogContent {...props} />;
}
