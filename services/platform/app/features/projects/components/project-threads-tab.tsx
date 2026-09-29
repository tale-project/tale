'use client';

/**
 * The project's Chats tab: the caller's own conversations filed here — each
 * with the "share with project" switch — and, below, the ones other members
 * shared. Reads the chat-v2 tables through `listThreadsForProject`; the
 * switch writes the owner-gated share flag on the thread itself.
 */

import { Button } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { EmptyState } from '@tale/ui/empty-state';
import { FormSection } from '@tale/ui/form-section';
import { PageSection } from '@tale/ui/page-section';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageCircle, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import { useSetThreadSharedWithProject } from '../hooks/mutations';
import { useProjectChatThreads } from '../hooks/queries';
import { ProjectThreadsSkeleton } from './project-tab-skeletons';

interface ProjectThreadsTabProps {
  organizationId: string;
  projectId: string;
}

/**
 * One chat of the project, read the way Home lists a chat: the bubble, the
 * title (or "Untitled chat"), when it last moved and one line of context —
 * the whole row opens it, while `trailing` (the share switch) stays its own
 * control above the row's link.
 */
function ProjectChatRow({
  organizationId,
  thread,
  context,
  trailing,
}: {
  organizationId: string;
  thread: { id: string; title?: string; updatedAt: number };
  context?: ReactNode;
  trailing?: ReactNode;
}) {
  const { t: tHome } = useT('home');
  const { formatRelative } = useFormatDate();
  const title = thread.title ?? tHome('row.untitledChat');
  return (
    <li className="hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 has-[a:focus-visible]:ring-ring relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-inset">
      <MessageCircle
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/dashboard/$id/chat/$threadId"
          params={{ id: organizationId, threadId: thread.id }}
          // The link's box covers the row, so the whole row opens the chat.
          className="text-foreground truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-['']"
          title={title}
        >
          {title}
        </Link>
        <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <span className="shrink-0 tabular-nums">
            {formatRelative(new Date(thread.updatedAt))}
          </span>
          {context !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{context}</span>
            </>
          )}
        </span>
      </span>
      {trailing !== undefined && (
        <span className="relative z-10 shrink-0">{trailing}</span>
      )}
    </li>
  );
}

export function ProjectThreadsTab({
  organizationId,
  projectId,
}: ProjectThreadsTabProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const {
    mine,
    shared: sharedThreads,
    isLoading,
  } = useProjectChatThreads(projectId);
  const { mutateAsync: setShared } = useSetThreadSharedWithProject();

  if (isLoading && mine.length === 0 && sharedThreads.length === 0) {
    return <ProjectThreadsSkeleton />;
  }

  const handleNewChat = () => {
    void navigate({
      to: '/dashboard/$id/chat',
      params: { id: organizationId },
      search: { projectId: projectId },
    });
  };

  const handleToggleShare = async (threadId: string, nextShared: boolean) => {
    try {
      await setShared({ organizationId, threadId, shared: nextShared });
      toast({
        title: nextShared
          ? t('threads.shareSuccess')
          : t('threads.unshareSuccess'),
        variant: 'success',
      });
    } catch (error) {
      if (error instanceof AppError) {
        const code = error.data?.code;
        if (code) {
          toast({
            title: t('errors.' + code, {
              defaultValue: t('threads.shareError'),
            }),
            variant: 'destructive',
          });
          return;
        }
      }
      console.error('setThreadSharedWithProject failed', error);
      toast({
        title: t('threads.shareError'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  };

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('threads.yourChats')}
        description={t('threads.subtitle')}
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={SquarePen}
            onClick={handleNewChat}
          >
            {t('overview.newChatCta')}
          </Button>
        }
      />

      <FormSection>
        {mine.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title={t('threads.emptyYours')}
            className="rounded-lg border border-dashed py-8"
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Text variant="muted" className="text-sm">
              {t('threads.shareToggleDisclosure')}
            </Text>
            <ul className="divide-y overflow-hidden rounded-lg border">
              {mine.map((thread) => (
                <ProjectChatRow
                  key={thread.id}
                  organizationId={organizationId}
                  thread={thread}
                  trailing={
                    <Switch
                      checked={thread.sharedWithProject === true}
                      onCheckedChange={(checked) =>
                        void handleToggleShare(thread.id, checked)
                      }
                      label={t('threads.shareToggle')}
                      // The disclosure above names the toggle; repeated on
                      // every row it left a phone's chat title a few letters.
                      hideLabelOnMobile
                    />
                  }
                />
              ))}
            </ul>
          </div>
        )}
      </FormSection>

      <PageSection
        title={t('threads.sharedWithProject')}
        gap={6}
        className="mt-8 border-t pt-8"
      >
        {sharedThreads.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title={t('threads.emptyShared')}
            className="rounded-lg border border-dashed py-8"
          />
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {sharedThreads.map((thread) => (
              <ProjectChatRow
                key={thread.id}
                organizationId={organizationId}
                thread={thread}
                context={thread.authorName ?? thread.userId.slice(0, 8)}
              />
            ))}
          </ul>
        )}
      </PageSection>
    </ContentArea>
  );
}
