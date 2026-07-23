'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { MessagesSquare } from 'lucide-react';
import { useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useProjectDiscussions } from '../hooks/queries';
import {
  discussionCategoryLabel,
  DISCUSSION_STATUS_BADGE,
  toDiscussionStatus,
} from '../lib';
import { DiscussionCreateDialog } from './discussion-create-dialog';
import { DiscussionThreadView } from './discussion-thread-view';

interface ProjectDiscussionsTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
  /** Deep-link from notification bell / email (`?thread=`). */
  initialThreadId?: string;
}

export function ProjectDiscussionsTab({
  organizationId,
  projectId,
  initialThreadId,
}: ProjectDiscussionsTabProps) {
  const { t } = useT('discussions');
  const [selectedThreadId, setSelectedThreadId] = useState(
    initialThreadId ?? null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const { data: discussions, isPending } = useProjectDiscussions(
    organizationId,
    projectId,
  );

  const rows = discussions ?? [];

  // The chat-layout context wrapper is gone with the chat composer these
  // views used to embed; the thread view now gates its transcript while the
  // chat backend is rebuilt.
  if (selectedThreadId) {
    return (
      <DiscussionThreadView
        organizationId={organizationId}
        projectId={projectId}
        threadId={selectedThreadId}
        onBack={() => setSelectedThreadId(null)}
      />
    );
  }

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('title')}
        description={t('subtitle')}
        action={<Button onClick={() => setCreateOpen(true)}>{t('new')}</Button>}
      />

      {isPending ? (
        <Skeletonize loading>
          <div className="divide-y rounded-lg border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-3">
                <SkeletonText lines={1} />
              </div>
            ))}
          </div>
        </Skeletonize>
      ) : rows.length === 0 ? (
        <EmptyPlaceholder icon={MessagesSquare}>{t('empty')}</EmptyPlaceholder>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((d) => {
            const status = toDiscussionStatus(d.discussionStatus);
            const category = d.discussionCategory;
            return (
              <button
                key={d.threadId}
                type="button"
                onClick={() => setSelectedThreadId(d.threadId)}
                className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <MessagesSquare
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {d.title ?? d.threadId}
                </span>
                {category ? (
                  <Badge variant="outline">
                    {discussionCategoryLabel(category, t)}
                  </Badge>
                ) : null}
                <Badge variant={DISCUSSION_STATUS_BADGE[status]}>
                  {t(`status.${status}`)}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <DiscussionCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        projectId={projectId}
        onCreated={(threadId) => {
          setCreateOpen(false);
          setSelectedThreadId(threadId);
        }}
      />
    </ContentArea>
  );
}
