'use client';

/**
 * Share dialog — Claude-style access picker on Tale's org-internal snapshot
 * model. A subtitle sets snapshot expectations, two stacked options choose
 * private vs organization link, and the footer creates the link once. When
 * live, the URL and Copy link sit in one row; Preview and Include newer
 * messages are secondary actions underneath.
 */

import { ActionRow } from '@tale/ui/action-row';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { Check, ExternalLink, Link2, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ComponentType } from 'react';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatQuery } from '../data/chat-backend';
import { useThreadSharing } from '../data/thread-sharing';

type ShareAccessMode = 'private' | 'organization';

function ShareAccessOption({
  selected,
  icon: Icon,
  label,
  description,
  onSelect,
  disabled,
}: {
  selected: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 p-3 text-left transition-colors',
        selected ? 'bg-muted/60' : 'hover:bg-muted/30',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <Stack gap={1} className="min-w-0 flex-1">
        <Text className="text-sm font-medium">{label}</Text>
        <Text variant="caption">{description}</Text>
      </Stack>
      {selected && (
        <Check className="text-primary size-4 shrink-0" aria-hidden />
      )}
    </button>
  );
}

function ShareChatDialogContent({
  open,
  onOpenChange,
  threadId,
  organizationId,
}: ShareChatDialogProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const sharing = useThreadSharing(organizationId);
  const [pending, setPending] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  const [accessMode, setAccessMode] = useState<ShareAccessMode>('private');

  const status = useChatQuery('chat/threads:getThreadShareStatus', {
    organizationId,
    threadId,
  });
  const share = status.status === 'ready' ? status.data : undefined;
  const isShared = share?.isShared === true;
  const isShareable = share?.isShareable ?? true;
  const blockSharing = !isShareable && !isShared;
  const statusLoading = status.status === 'loading';

  const shareUrl =
    isShared && share?.shareToken != null
      ? `${window.location.origin}/dashboard/${organizationId}/chat/shared/${share.shareToken}`
      : '';

  useEffect(() => {
    if (!open) {
      setPublishFailed(false);
      return;
    }
    setAccessMode(isShared ? 'organization' : 'private');
  }, [open, isShared]);

  const publish = useCallback(async () => {
    setPending(true);
    setPublishFailed(false);
    try {
      const token = await sharing.share(threadId);
      if (token === null) {
        setPublishFailed(true);
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
  }, [isShareable, sharing, t, threadId]);

  const unshare = useCallback(async () => {
    setPending(true);
    try {
      const ok = await sharing.unshare(threadId);
      if (!ok) {
        toast({ title: t('share.unshareFailed'), variant: 'destructive' });
        setAccessMode('organization');
        return;
      }
      toast({ title: t('share.unshared') });
    } finally {
      setPending(false);
    }
  }, [sharing, t, threadId]);

  const handleAccessMode = (mode: ShareAccessMode) => {
    if (mode === accessMode || pending || statusLoading) return;
    setAccessMode(mode);
    if (mode === 'private' && isShared) {
      void unshare();
    }
  };

  const showCreateFooter =
    !blockSharing &&
    accessMode === 'organization' &&
    !isShared &&
    !statusLoading;

  const dialogDescription = isShared
    ? t('share.snapshotHintShared')
    : t('share.snapshotHint');

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('share.title')}
      description={blockSharing ? undefined : dialogDescription}
      size="md"
      footer={
        showCreateFooter ? (
          <Button
            onClick={() => void publish()}
            disabled={pending}
            className="w-full sm:w-auto"
          >
            {publishFailed ? t('share.retry') : t('share.createLink')}
          </Button>
        ) : undefined
      }
    >
      <Stack gap={4} className="min-w-0 overflow-hidden">
        {blockSharing ? (
          <Text variant="muted" className="text-sm">
            {t('share.notShareable')}
          </Text>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label={t('share.accessPickerLabel')}
              className="border-border divide-border divide-y overflow-hidden rounded-lg border"
            >
              <ShareAccessOption
                selected={accessMode === 'private'}
                icon={Lock}
                label={t('share.keepPrivate')}
                description={t('share.keepPrivateDescription')}
                onSelect={() => handleAccessMode('private')}
                disabled={pending || statusLoading}
              />
              <ShareAccessOption
                selected={accessMode === 'organization'}
                icon={Link2}
                label={t('share.organizationLink')}
                description={t('share.organizationLinkDescription')}
                onSelect={() => handleAccessMode('organization')}
                disabled={pending || statusLoading}
              />
            </div>

            {accessMode === 'organization' && (isShared || pending) && (
              <Stack gap={3} className="min-w-0">
                {isShared && shareUrl.length > 0 ? (
                  <CopyableField
                    value={shareUrl}
                    mono
                    copyAriaLabel={t('share.copyLink')}
                  />
                ) : (
                  <Skeletonize loading label={t('share.creatingLink')}>
                    <CopyableField
                      value="https://example.com/share/preview"
                      mono
                      copyAriaLabel={t('share.copyLink')}
                    />
                  </Skeletonize>
                )}

                {isShared && (
                  <ActionRow gap={2} className="min-w-0 flex-wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={ExternalLink}
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
                    >
                      {t('share.preview')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RefreshCw}
                      onClick={() => void publish()}
                      disabled={pending}
                    >
                      {t('share.includeNewer')}
                    </Button>
                  </ActionRow>
                )}
              </Stack>
            )}
          </>
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
