'use client';

/**
 * The per-thread share control: publish the conversation as an org-internal,
 * read-only snapshot link, or take that link down.
 *
 * Sharing copies the link in the same gesture — the reason to share is to
 * paste the URL somewhere, so minting it and handing it over are one action.
 * Re-sharing an already-shared thread keeps the URL stable and republishes
 * the snapshot with the turns that happened since.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Link2, Link2Off, Share2 } from 'lucide-react';

import { useCopy } from '@/app/hooks/use-copy';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useThreadSharing } from '../data/thread-sharing';
import type { ChatThreadSummary } from '../types';

interface ThreadShareMenuProps {
  organizationId: string;
  thread: ChatThreadSummary;
}

export function ThreadShareMenu({
  organizationId,
  thread,
}: ThreadShareMenuProps) {
  const { t } = useT('chat');
  const sharing = useThreadSharing(organizationId);
  const { copy } = useCopy();

  async function shareAndCopyLink() {
    const shareToken = await sharing.share(thread.id);
    if (!shareToken) {
      toast({ title: t('share.shareFailed'), variant: 'destructive' });
      return;
    }
    const url = `${window.location.origin}/dashboard/${organizationId}/chat/shared/${shareToken}`;
    // `copy` raises its own failure toast; the link is live either way.
    if (await copy(url)) {
      toast({ title: t('share.copied') });
    }
  }

  async function stopSharing() {
    if (await sharing.unshare(thread.id)) {
      toast({ title: t('share.unshared') });
    } else {
      toast({ title: t('share.unshareFailed'), variant: 'destructive' });
    }
  }

  const items: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: t('share.button'),
        icon: Link2,
        onClick: () => void shareAndCopyLink(),
      },
      ...(thread.isShared
        ? [
            {
              type: 'item' as const,
              label: t('share.unshare'),
              icon: Link2Off,
              onClick: () => void stopSharing(),
            },
          ]
        : []),
    ],
  ];

  return (
    <DropdownMenu
      trigger={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('share.title')}
          className="text-muted-foreground hover:text-foreground size-7 shrink-0"
        >
          <Share2 aria-hidden className="size-3.5" />
        </Button>
      }
      items={items}
      align="end"
      disabled={!sharing.available}
    />
  );
}
