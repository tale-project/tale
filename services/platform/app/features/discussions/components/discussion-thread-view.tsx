'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ArrowLeft } from 'lucide-react';

import { RebuildGate } from '@/app/components/layout/rebuild-gate';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDiscussion } from '../hooks/queries';
import {
  discussionCategoryLabel,
  DISCUSSION_STATUS_BADGE,
  toDiscussionStatus,
} from '../lib';

interface DiscussionThreadViewProps {
  organizationId: string;
  projectId: Id<'projects'>;
  threadId: string;
  onBack: () => void;
}

/**
 * A single discussion, opened from the project's discussions list. The
 * transcript and reply composer ran on the chat message pipeline, which is
 * offline while the AI backend is rewritten — there is currently no way to
 * read a discussion's messages, so the body is gated. The header keeps the
 * live metadata (title, status, category) and the way back to the list; the
 * full thread view returns with the chat rebuild.
 */
export function DiscussionThreadView({
  organizationId,
  threadId,
  onBack,
}: DiscussionThreadViewProps) {
  const { t } = useT('discussions');

  const { data: discussion } = useDiscussion(organizationId, threadId);
  const status = toDiscussionStatus(discussion?.discussionStatus);
  const category = discussion?.discussionCategory;

  return (
    <Stack gap={0} className="h-full">
      <Row
        gap={3}
        justify="between"
        className="border-border min-h-13 border-b px-5 py-2"
      >
        <HStack gap={3} align="center" className="min-w-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title={t('backToList')}
          >
            <ArrowLeft className="text-muted-foreground size-5" />
          </Button>
          <div className="min-w-0">
            <HStack gap={2} align="center">
              <span className="truncate text-sm font-semibold">
                {discussion?.title ?? t('untitled')}
              </span>
              <Badge variant={DISCUSSION_STATUS_BADGE[status]}>
                {t(`status.${status}`)}
              </Badge>
            </HStack>
            {category ? (
              <Text variant="caption" className="text-muted-foreground text-xs">
                {discussionCategoryLabel(category, t)}
              </Text>
            ) : null}
          </div>
        </HStack>
      </Row>

      <Stack gap={0} className="h-full min-h-0 flex-1">
        <RebuildGate feature="Discussion threads" />
      </Stack>
    </Stack>
  );
}
