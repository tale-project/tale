'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import {
  MessagesSquare,
  Download,
  Ellipsis,
  Search,
  Share,
} from 'lucide-react';
import { useState, useMemo } from 'react';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { useSidebar } from '@/app/components/layout/app-sidebar/sidebar-context';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { ExportChatDialog } from './export-chat-dialog';
import { ShareChatDialog } from './share-chat-dialog';

interface ChatHeaderProps {
  organizationId: string;
  threadId?: string;
}

/**
 * Chat-surface header. The sidebar toggle, search affordance, and their ⌘H/⌘K
 * bindings live in the shell's unified sidebar now — on desktop this header
 * only carries the per-thread actions (Share + overflow), so it renders
 * nothing without a thread. The mobile bar keeps its hamburger + search
 * buttons, wired to the shared sidebar state (drawer + palette).
 */
export function ChatHeader({ organizationId, threadId }: ChatHeaderProps) {
  const { isMobileSheetOpen, setMobileSheetOpen, setSearchOpen } = useSidebar();
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);

  const { t: tChat } = useT('chat');

  // The per-thread voice toggle moved to the composer (next to dictation),
  // so the header dropdown now only carries the export action.
  const headerMenuItems = useMemo<DropdownMenuGroup[]>(
    () => [
      [
        {
          type: 'item' as const,
          label: tChat('export.button'),
          icon: Download,
          onClick: () => setIsExportDialogOpen(true),
        },
      ],
    ],
    [tChat],
  );

  const baseIconClasses = 'size-5 text-muted-foreground p-0.25';

  return (
    <>
      {threadId && (
        <div className="border-border bg-background/95 hidden h-13 items-center justify-end border-b px-4 backdrop-blur-xs md:flex">
          <Button
            variant="ghost"
            onClick={() => setIsShareDialogOpen(true)}
            aria-label={tChat('share.button')}
            className="text-muted-foreground gap-1.5"
          >
            <Share className="size-4" />
            {tChat('share.button')}
          </Button>
          <DropdownMenu
            trigger={
              <Button
                size="icon"
                variant="ghost"
                aria-label={tChat('moreActions')}
              >
                <Ellipsis className={baseIconClasses} />
              </Button>
            }
            items={headerMenuItems}
            align="end"
          />
        </div>
      )}

      <AdaptiveHeaderRoot className="md:hidden">
        <Row gap={0} align="stretch" className="flex-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setMobileSheetOpen(!isMobileSheetOpen)}
            aria-label={
              isMobileSheetOpen ? tChat('hideHistory') : tChat('showHistory')
            }
            aria-expanded={isMobileSheetOpen}
          >
            <MessagesSquare
              className={cn(
                baseIconClasses,
                isMobileSheetOpen && 'text-accent-foreground',
              )}
            />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSearchOpen(true)}
            title={tChat('searchChat')}
          >
            <Search className={baseIconClasses} />
          </Button>
          {threadId && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsShareDialogOpen(true)}
                title={tChat('share.button')}
              >
                <Share className={baseIconClasses} />
              </Button>
              <DropdownMenu
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={tChat('moreActions')}
                  >
                    <Ellipsis className={baseIconClasses} />
                  </Button>
                }
                items={headerMenuItems}
                align="end"
              />
            </>
          )}
        </Row>
      </AdaptiveHeaderRoot>

      {threadId && (
        <>
          <ExportChatDialog
            open={isExportDialogOpen}
            onOpenChange={setIsExportDialogOpen}
            threadId={threadId}
            organizationId={organizationId}
          />
          <ShareChatDialog
            open={isShareDialogOpen}
            onOpenChange={setIsShareDialogOpen}
            threadId={threadId}
            organizationId={organizationId}
          />
        </>
      )}
    </>
  );
}
