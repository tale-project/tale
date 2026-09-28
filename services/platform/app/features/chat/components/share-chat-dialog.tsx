'use client';

/**
 * Share dialog — Claude-style access picker on Tale's org-internal snapshot
 * model. A subtitle sets snapshot expectations, two stacked options choose
 * private vs organization link, and the footer creates the link once. When
 * live, the URL and Copy link sit in one row; Preview and Include newer
 * messages are secondary actions underneath.
 *
 * The picker claims only what the status read answered: masked while it
 * loads, and — when it failed — no option checked or selectable (the chat may
 * still be shared) until Try again reads it back.
 */

import { ActionRow } from '@tale/ui/action-row';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { CopyableField } from '@tale/ui/copyable-field';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Stack } from '@tale/ui/layout';
import { RadioGroup, RadioGroupItem } from '@tale/ui/radio-group';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { useNavigate } from '@tanstack/react-router';
import { ExternalLink, Link2, Lock, RefreshCw } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  threadShareUrl,
  useThreadShareStatus,
  useThreadSharing,
} from '../data/thread-sharing';

type ShareAccessMode = 'private' | 'organization';

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** One option row: the whole row selects, the radio is the design-system
 * control (one tab stop, arrow keys), named by the row's label alone. */
function ShareAccessOption({
  value,
  selected,
  state,
  icon: Icon,
  label,
  description,
}: {
  value: ShareAccessMode;
  selected: boolean;
  /** `loading`: masked until the status read answers. `unknown`: the read
   * failed, so the option takes no choice. `busy`: a change is in flight —
   * the option keeps its focus but takes no choice. */
  state: 'ready' | 'loading' | 'unknown' | 'busy';
  icon: ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={`${id}-radio`}
      className={cn(
        'flex w-full items-center gap-3 p-3 transition-colors',
        selected && 'bg-muted/60',
        state === 'ready' && 'cursor-pointer',
        state === 'ready' && !selected && 'hover:bg-muted/30',
        state === 'unknown' && 'cursor-not-allowed opacity-60',
        state === 'busy' && 'cursor-progress opacity-60',
      )}
    >
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <Stack gap={1} className="min-w-0 flex-1">
        <Text id={`${id}-label`} className="text-sm font-medium">
          {label}
        </Text>
        <Text id={`${id}-description`} variant="caption">
          {description}
        </Text>
      </Stack>
      <RadioGroupItem
        id={`${id}-radio`}
        value={value}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        aria-disabled={state === 'busy' || undefined}
      />
    </label>
  );
}

function ShareChatDialogContent({
  open,
  onOpenChange,
  threadId,
  viewThreadId,
  organizationId,
}: ShareChatDialogProps) {
  const { t } = useT('chat');
  const navigate = useNavigate();
  const sharing = useThreadSharing(organizationId);
  const status = useThreadShareStatus(organizationId, threadId);
  const [pending, setPending] = useState(false);
  const [publishFailed, setPublishFailed] = useState(false);
  // A choice the status does not show yet: the organization option before
  // its link exists, or Keep private while the revocation is on its way.
  const [draft, setDraft] = useState<ShareAccessMode | null>(null);

  const known = status.state === 'known' ? status : null;
  const isShared = known?.isShared === true;
  const isShareable = known?.isShareable ?? true;
  const blockSharing = !isShareable && !isShared;
  const accessMode: ShareAccessMode | undefined =
    known === null
      ? undefined
      : (draft ?? (isShared ? 'organization' : 'private'));

  const shareToken = isShared ? (known?.shareToken ?? null) : null;
  const shareUrl =
    shareToken !== null ? threadShareUrl(organizationId, shareToken) : '';

  const publish = useCallback(async () => {
    setPending(true);
    setPublishFailed(false);
    try {
      // The snapshot is the branch on screen — the version of each edited
      // or regenerated turn the owner is looking at; a re-publish
      // ("Include newer messages") re-takes it from the same place.
      const token = await sharing.share(threadId, viewThreadId);
      if (token === null) {
        setPublishFailed(true);
        toast({
          title: t(
            isShareable ? 'share.shareFailed' : 'share.cannotShareArena',
          ),
          variant: 'destructive',
        });
        return;
      }
      setDraft(null);
    } finally {
      setPending(false);
    }
  }, [isShareable, sharing, t, threadId, viewThreadId]);

  const unshare = useCallback(async () => {
    setPending(true);
    setDraft('private');
    try {
      const ok = await sharing.unshare(threadId);
      if (!ok) {
        toast({ title: t('share.unshareFailed'), variant: 'destructive' });
        return;
      }
      toast({ title: t('share.unshared') });
    } finally {
      // Whatever happened, the status now says it: revoked, or still live.
      setDraft(null);
      setPending(false);
    }
  }, [sharing, t, threadId]);

  const handleAccessMode = (value: string) => {
    if (known === null || pending) return;
    const mode: ShareAccessMode =
      value === 'organization' ? 'organization' : 'private';
    if (mode === accessMode) return;
    if (mode === 'private' && isShared) {
      void unshare();
      return;
    }
    setDraft(mode === 'organization' ? 'organization' : null);
  };

  // While a change is in flight the focused option stays put: an arrow key
  // would otherwise move focus onto an option the dialog cannot select yet.
  const holdArrowsWhilePending = (event: KeyboardEvent) => {
    if (pending && ARROW_KEYS.has(event.key)) event.preventDefault();
  };

  const optionState =
    status.state === 'known' ? (pending ? 'busy' : 'ready') : status.state;

  const showCreateFooter =
    known !== null &&
    !blockSharing &&
    accessMode === 'organization' &&
    !isShared;

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
            <Skeletonize loading={status.state === 'loading'}>
              <RadioGroup
                aria-label={t('share.accessPickerLabel')}
                value={accessMode ?? ''}
                onValueChange={handleAccessMode}
                disabled={known === null}
                aria-busy={pending || undefined}
                onKeyDownCapture={holdArrowsWhilePending}
                className="border-border divide-border gap-0 divide-y overflow-hidden rounded-lg border"
              >
                <ShareAccessOption
                  value="private"
                  selected={accessMode === 'private'}
                  state={optionState}
                  icon={Lock}
                  label={t('share.keepPrivate')}
                  description={t('share.keepPrivateDescription')}
                />
                <ShareAccessOption
                  value="organization"
                  selected={accessMode === 'organization'}
                  state={optionState}
                  icon={Link2}
                  label={t('share.organizationLink')}
                  description={t('share.organizationLinkDescription')}
                />
              </RadioGroup>
            </Skeletonize>

            {status.state === 'unknown' && (
              <Alert
                variant="destructive"
                description={t('share.statusFailed')}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RefreshCw}
                  className="mt-3"
                  onClick={status.retry}
                >
                  {t('share.retry')}
                </Button>
              </Alert>
            )}

            {accessMode === 'organization' && (isShared || pending) && (
              <Stack gap={3} className="min-w-0">
                {shareUrl.length > 0 ? (
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

                {shareToken !== null && (
                  <ActionRow gap={2} className="min-w-0 flex-wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={ExternalLink}
                      onClick={() => {
                        onOpenChange(false);
                        void navigate({
                          to: '/dashboard/$id/chat/shared/$shareToken',
                          params: { id: organizationId, shareToken },
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
  /** The lineage root — the id the URL and the share link name. */
  threadId: string;
  /** The sibling on screen (the root itself when no edit / regenerate
   * version is selected); the snapshot is frozen to it. */
  viewThreadId: string;
  organizationId: string;
}

/** Mounted only while open — the status read starts with the dialog. */
export function ShareChatDialog(props: ShareChatDialogProps) {
  if (!props.open) return null;
  return <ShareChatDialogContent {...props} />;
}
