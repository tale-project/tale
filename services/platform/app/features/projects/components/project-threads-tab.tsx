'use client';

/**
 * The project's Chats tab: the caller's own conversations filed here — each
 * with the "share with project" switch — and, below, the ones other members
 * shared. Reads the chat-v2 tables through `listThreadsForProject`; the
 * switch writes the owner-gated share flag on the thread itself.
 */

import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ContentArea } from '@tale/ui/content-area';
import { EmptyState } from '@tale/ui/empty-state';
import { FormSection } from '@tale/ui/form-section';
import { PageSection } from '@tale/ui/page-section';
import { findScrollableAncestor } from '@tale/ui/scroll-wheel-chain';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';
import {
  defaultRangeExtractor,
  useVirtualList,
  type Range,
} from '@tale/ui/use-virtual-list';
import { Link, useNavigate } from '@tanstack/react-router';
import { MessageCircle, SquarePen } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

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

interface ChatRowPlacement {
  index: number;
  total: number;
  style?: CSSProperties;
  measure: (element: HTMLLIElement | null) => void;
}

/** Both sections use the page's existing scrollport and retain the focused
 * chat and its neighbours so native link/switch Tab order keeps working. */
function ProjectChatList<Thread extends { id: string }>({
  threads,
  renderRow,
}: {
  threads: readonly Thread[];
  renderRow: (thread: Thread, placement?: ChatRowPlacement) => ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const windowed = threads.length > 80;
  const focusedIndex = threads.findIndex((thread) => thread.id === focusedId);
  const virtualizer = useVirtualList<HTMLElement, HTMLLIElement>({
    count: threads.length,
    enabled: threads.length > 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => 64,
    initialRect: { width: 800, height: 600 },
    getItemKey: useCallback(
      (index: number) => threads[index]?.id ?? index,
      [threads],
    ),
    overscan: 8,
    scrollMargin,
    measureElement: (element, entry) =>
      entry?.borderBoxSize[0]?.blockSize ??
      element.getBoundingClientRect().height,
    useAnimationFrameWithResizeObserver: true,
    rangeExtractor: useCallback(
      (range: Range) => {
        const indices = new Set(defaultRangeExtractor(range));
        for (const index of [
          focusedIndex - 1,
          focusedIndex,
          focusedIndex + 1,
        ]) {
          if (index >= 0 && index < threads.length) indices.add(index);
        }
        return [...indices].sort((a, b) => a - b);
      },
      [focusedIndex, threads.length],
    ),
  });
  const measureRow = useCallback(
    (element: HTMLLIElement | null) => {
      // The parent scrollport attaches after the native row refs. Rebind
      // them once it exists so their actual heights seed the measured cache.
      if (element === null || scrollElement !== null)
        virtualizer.measureElement(element);
    },
    [virtualizer, scrollElement],
  );
  // Build the measured source in native mode too, before its row refs run.
  // Their heights then survive the first positioned render at the threshold.
  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = list && findScrollableAncestor(list.parentElement);
    if (!list || !scroller) return undefined;
    setScrollElement(scroller);
    const measure = () =>
      setScrollMargin(
        list.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    measure();
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });
    observer.observe(scroller);
    const content = list.closest('[data-project-chats]');
    if (content) observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [windowed]);

  return (
    <ul
      ref={listRef}
      className="relative divide-y overflow-hidden rounded-lg border"
      style={windowed ? { height: totalSize } : undefined}
      onFocusCapture={(event) => {
        const row = event.target.closest<HTMLElement>(
          '[data-project-thread-id]',
        );
        if (row?.dataset.projectThreadId)
          setFocusedId(row.dataset.projectThreadId);
      }}
    >
      {windowed
        ? virtualizer.getVirtualItems().map((item) => {
            const thread = threads[item.index];
            return thread
              ? renderRow(thread, {
                  index: item.index,
                  total: threads.length,
                  measure: measureRow,
                  style: {
                    position: 'absolute',
                    top: item.start - scrollMargin,
                    left: 0,
                    width: '100%',
                  },
                })
              : null;
          })
        : threads.map((thread, index) =>
            renderRow(thread, {
              index,
              total: threads.length,
              measure: measureRow,
            }),
          )}
    </ul>
  );
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
  placement,
}: {
  organizationId: string;
  thread: { id: string; title?: string; updatedAt: number };
  context?: ReactNode;
  trailing?: ReactNode;
  placement?: ChatRowPlacement;
}) {
  const { t: tHome } = useT('home');
  const { formatRelative } = useFormatDate();
  const title = thread.title ?? tHome('row.untitledChat');
  return (
    <li
      ref={placement?.measure}
      data-project-thread-id={thread.id}
      data-index={placement?.index}
      aria-posinset={placement ? placement.index + 1 : undefined}
      aria-setsize={placement?.total}
      style={placement?.style}
      className="hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 has-[a:focus-visible]:ring-ring relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-inset"
    >
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
    unavailable,
    stale,
    retrying,
    failureCount,
    retry,
  } = useProjectChatThreads(projectId);
  const { mutateAsync: setShared } = useSetThreadSharedWithProject();
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusBody = useCallback(() => {
    bodyRef.current?.focus();
  }, []);

  if (
    isLoading &&
    !unavailable &&
    mine.length === 0 &&
    sharedThreads.length === 0
  ) {
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

      <div
        ref={bodyRef}
        data-project-chats
        role="group"
        aria-label={t('threads.yourChats')}
        tabIndex={-1}
        className="flex flex-col gap-6 outline-none"
      >
        {unavailable || stale ? (
          <CatalogLoadError
            failureKey={failureCount}
            onFocusLost={focusBody}
            message={
              unavailable ? t('threads.loadFailed') : t('threads.refreshFailed')
            }
            onRetry={retry}
            isRetrying={retrying}
          />
        ) : null}

        {unavailable ? null : (
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
                <ProjectChatList
                  threads={mine}
                  renderRow={(thread, placement) => (
                    <ProjectChatRow
                      key={thread.id}
                      organizationId={organizationId}
                      thread={thread}
                      placement={placement}
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
                  )}
                />
              </div>
            )}
          </FormSection>
        )}

        {unavailable ? null : (
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
              <ProjectChatList
                threads={sharedThreads}
                renderRow={(thread, placement) => (
                  <ProjectChatRow
                    key={thread.id}
                    organizationId={organizationId}
                    thread={thread}
                    placement={placement}
                    context={thread.authorName ?? thread.userId.slice(0, 8)}
                  />
                )}
              />
            )}
          </PageSection>
        )}
      </div>
    </ContentArea>
  );
}
