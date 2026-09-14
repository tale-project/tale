import '@testing-library/jest-dom/vitest';
import { Badge } from '@tale/ui/badge';
import { CatalogCardSkeleton } from '@tale/ui/catalog/catalog-card-skeleton';
import { CatalogCard, CatalogCardIcon } from '@tale/ui/catalog/catalog-grid';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from '@/app/features/chat/components/composer';
import { ConversationSkeleton } from '@/app/features/chat/components/conversation-skeleton';
import { MessageThread } from '@/app/features/chat/components/message-thread';
import { toSettledItems } from '@/app/features/chat/lib/thread-view-core';
import {
  ConversationDateHeader,
  MessageTimestamp,
} from '@/app/features/conversations/components/conversation-message-layout';
import { Message as InboxMessage } from '@/app/features/conversations/components/message';
import { documentPageClasses } from '@/app/features/documents/components/document-prose-classes';
import {
  PreviewPane,
  PreviewPaneSkeleton,
  previewPaneDocumentClasses,
} from '@/app/features/documents/components/preview-pane';
import { TaskCard } from '@/app/features/tasks/components/task-card';
import { TasksList } from '@/app/features/tasks/components/tasks-list';
import { TasksSkeleton } from '@/app/features/tasks/components/tasks-skeleton';
import type { TaskDoc } from '@/app/features/tasks/lib/display';
import { render, screen } from '@/tests/utils/render';

import { ChatComposerPlaceholder } from './chat-composer-placeholder';

import '@/app/globals.css';

vi.mock('@/app/features/chat/hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: true,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock('@/app/features/chat/hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));
vi.mock('@tale/ui/email-preview', () => ({
  EmailPreview: ({ html }: { html: string }) => <div>{html}</div>,
}));
vi.mock('@/app/features/tasks/hooks/mutations', () => ({
  useMoveTask: () => ({ mutate: vi.fn(), isPending: false }),
  useAssignTask: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/features/tasks/hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    currentUserId: null,
    resolveActor: () => null,
  }),
}));
vi.mock('@/app/features/tasks/hooks/use-task-status-choreography', () => ({
  useTaskStatusChoreography: () => async () => 'move' as const,
}));
vi.mock('@/app/features/tasks/hooks/use-task-subject-contract', () => ({
  useTaskSubjectContract: () => null,
  useTaskContractAutomations: () => [],
  taskSubjectEntries: () => [],
}));

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('boot-chat', 'dark');
});

function requireElement(root: Element, selector: string) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

function size(element: Element) {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
}

const TASK = {
  _id: 'skeleton_task',
  _creationTime: 0,
  organizationId: 'org_test',
  projectId: 'project_test',
  title: 'Check the loading layout',
  status: 'todo',
  rank: 'a0',
  number: 1,
  createdBy: 'user_test',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
} as unknown as TaskDoc;

describe('page skeleton geometry in Chromium', () => {
  for (const dark of [false, true]) {
    for (const width of [280, 760]) {
      it(`matches catalog card dimensions and surface at ${width}px (${dark ? 'dark' : 'light'})`, () => {
        document.documentElement.classList.toggle('dark', dark);
        const { rerender } = render(
          <div data-testid="fixture" style={{ width }}>
            <CatalogCard
              media={<CatalogCardIcon>{null}</CatalogCardIcon>}
              title="Example card"
              badge={<Badge>Ready</Badge>}
              description={
                <>
                  First description line.
                  <br />
                  Second description line.
                </>
              }
              actions={<span className="block h-8 w-20 rounded-md" />}
            />
          </div>,
        );
        const live = requireElement(
          screen.getByTestId('fixture'),
          '.border-border-base',
        );
        const liveSize = size(live);
        const liveSurface = getComputedStyle(live).backgroundColor;
        const liveFooter = requireElement(live, '.h-8').getBoundingClientRect();
        rerender(
          <div data-testid="fixture" style={{ width }}>
            <Skeletonize loading>
              <CatalogCardSkeleton footer />
            </Skeletonize>
          </div>,
        );
        const skeleton = requireElement(
          screen.getByTestId('fixture'),
          '.border-border-base',
        );
        expect(size(skeleton)).toEqual(liveSize);
        expect(getComputedStyle(skeleton).backgroundColor).toBe(liveSurface);
        const footer = requireElement(skeleton, '.h-8').getBoundingClientRect();
        expect(footer.x).toBe(liveFooter.x);
        expect(footer.y).toBe(liveFooter.y);
      });
    }
  }

  it.each([320, 900])(
    'matches the empty chat composer frame at %ipx',
    (width) => {
      document.documentElement.classList.add('boot-chat');
      const { rerender } = render(
        <div data-testid="fixture" style={{ width }} className="px-4 pb-4">
          <Composer
            draftKey={`geometry-${width}`}
            models={[]}
            selection={{}}
            onSelectionChange={() => {}}
            onSend={() => {}}
            onAttachFiles={() => {}}
            onVoiceOutputChange={() => {}}
          />
        </div>,
      );
      const live = requireElement(screen.getByTestId('fixture'), 'section');
      const frame = size(live);
      const field = size(requireElement(live, 'textarea'));
      rerender(
        <div data-testid="fixture" style={{ width }}>
          <ChatComposerPlaceholder />
        </div>,
      );
      const placeholder = requireElement(
        screen.getByTestId('fixture'),
        '.border',
      );
      expect(size(placeholder)).toEqual(frame);
      expect(
        size(requireElement(placeholder, '.sm\\:min-h-\\[100px\\]')),
      ).toEqual(field);
      expect(getComputedStyle(placeholder).rowGap).toBe('8px');
    },
  );

  it('matches conversation column clearance and user bubble shape', () => {
    const fixture = (loading: boolean) => (
      <div
        data-testid="fixture"
        style={{ width: 900, height: 600 }}
        className="flex flex-col"
      >
        {loading ? (
          <ConversationSkeleton
            label="Loading conversation"
            className="md:pt-13"
          />
        ) : (
          <MessageThread
            className="md:pt-13"
            messages={toSettledItems([
              {
                id: 'm1',
                role: 'user',
                sequence: 1,
                createdAt: 0,
                parts: [{ type: 'text', text: 'A short prompt.' }],
              },
            ])}
          />
        )}
      </div>
    );
    const { rerender } = render(fixture(false));
    const liveColumn = requireElement(
      screen.getByTestId('fixture'),
      '.max-w-3xl',
    ).getBoundingClientRect();
    const bubble = requireElement(
      screen.getByTestId('fixture'),
      '.rounded-2xl',
    );
    const liveBubble = bubble.getBoundingClientRect();
    const radius = getComputedStyle(bubble).borderRadius;
    rerender(fixture(true));
    const column = requireElement(
      screen.getByTestId('fixture'),
      '.max-w-3xl',
    ).getBoundingClientRect();
    const placeholder = requireElement(
      screen.getByTestId('fixture'),
      '.rounded-2xl',
    );
    expect(column.x).toBe(liveColumn.x);
    expect(column.width).toBe(liveColumn.width);
    expect(placeholder.getBoundingClientRect().y).toBe(liveBubble.y);
    expect(placeholder.getBoundingClientRect().right).toBe(liveBubble.right);
    expect(placeholder.getBoundingClientRect().height).toBe(liveBubble.height);
    expect(getComputedStyle(placeholder).borderRadius).toBe(radius);
  });

  it.each([false, true])(
    'matches inbox timestamp line height and outgoing spacing (customer: %s)',
    (isCustomer) => {
      const { rerender } = render(
        <div data-testid="fixture" style={{ width: 360 }}>
          <InboxMessage
            message={{
              id: 'inbox_geometry',
              sender: isCustomer ? 'customer' : 'connector',
              content: 'Short message',
              timestamp: '2026-09-14T10:00:00Z',
              isCustomer,
              status: 'sent',
            }}
          />
        </div>,
      );
      const live = requireElement(
        screen.getByTestId('fixture'),
        '.text-nowrap',
      );
      const liveHeight = size(live).height;
      const liveMargin = getComputedStyle(live).marginBottom;
      rerender(
        <div data-testid="fixture" style={{ width: 360 }}>
          <Skeletonize loading>
            <MessageTimestamp isCustomer={isCustomer}>
              <span className="w-20">
                <SkeletonText />
              </span>
            </MessageTimestamp>
          </Skeletonize>
        </div>,
      );
      const placeholder = requireElement(
        screen.getByTestId('fixture'),
        '.text-nowrap',
      );
      expect(size(placeholder).height).toBe(liveHeight);
      expect(getComputedStyle(placeholder).marginBottom).toBe(liveMargin);
    },
  );

  it.each([320, 900])(
    'preserves inbox date-chip height and rounded surface at %ipx',
    (width) => {
      const fixture = (loading: boolean) => (
        <div data-testid="fixture" style={{ width }}>
          <Skeletonize loading={loading} className="contents">
            <ConversationDateHeader>
              {loading ? (
                <span className="inline-block w-20">{'\u00a0'}</span>
              ) : (
                'Sep 14, 2026'
              )}
            </ConversationDateHeader>
          </Skeletonize>
          <div data-testid="message-start" />
        </div>
      );
      const { rerender } = render(fixture(false));
      const live = requireElement(
        screen.getByTestId('fixture'),
        '.rounded-full',
      );
      const liveHeight = size(live).height;
      const liveRadius = getComputedStyle(live).borderRadius;
      const liveMessageTop = screen
        .getByTestId('message-start')
        .getBoundingClientRect().top;
      rerender(fixture(true));
      const placeholder = requireElement(
        screen.getByTestId('fixture'),
        '.rounded-full',
      );
      expect(size(placeholder).height).toBe(liveHeight);
      expect(getComputedStyle(placeholder).borderRadius).toBe(liveRadius);
      expect(placeholder).toHaveAttribute('data-skeleton-mask', 'circle');
      expect(
        screen.getByTestId('message-start').getBoundingClientRect().top,
      ).toBe(liveMessageTop);
    },
  );

  it.each([false, true])(
    'matches task card and list row heights (editable: %s)',
    (canEdit) => {
      const { rerender } = render(
        <div data-testid="fixture" style={{ width: 272 }}>
          <TaskCard task={TASK} projectKey="TAL" canEdit={canEdit} />
        </div>,
      );
      const liveCard = requireElement(
        screen.getByTestId('fixture'),
        '.border-border-base',
      );
      const card = size(liveCard);
      const surface = getComputedStyle(liveCard).backgroundColor;
      rerender(
        <div
          data-testid="fixture"
          style={{ width: 900, height: 600 }}
          className="flex flex-col"
        >
          <TasksSkeleton view="board" canEdit={canEdit} />
        </div>,
      );
      const placeholderCard = requireElement(
        screen.getByTestId('fixture'),
        '.border-border-base',
      );
      expect(size(placeholderCard)).toEqual(card);
      expect(getComputedStyle(placeholderCard).backgroundColor).toBe(surface);
      expect(
        requireElement(
          screen.getByTestId('fixture'),
          'section',
        ).getBoundingClientRect().height,
      ).toBe(584);

      rerender(
        <div data-testid="fixture" style={{ width: 760, height: 600 }}>
          <TasksList tasks={[TASK]} projectKey="TAL" canEdit={canEdit} />
        </div>,
      );
      const liveRow = screen.getByText(TASK.title).parentElement;
      if (!liveRow) throw new Error('Missing task row');
      const rowHeight = liveRow.getBoundingClientRect().height;
      rerender(
        <div
          data-testid="fixture"
          style={{ width: 760, height: 600 }}
          className="flex flex-col"
        >
          <TasksSkeleton view="list" canEdit={canEdit} />
        </div>,
      );
      expect(
        requireElement(
          screen.getByTestId('fixture'),
          '.border-b',
        ).getBoundingClientRect().height,
      ).toBe(rowHeight);
    },
  );

  it.each([320, 900])(
    'keeps a short document page at its actual pane height at %ipx',
    (width) => {
      const fixture = (loading: boolean) => (
        <div
          data-testid="fixture"
          style={{ width, height: 500 }}
          className="flex flex-col"
        >
          {loading ? (
            <PreviewPaneSkeleton />
          ) : (
            <PreviewPane className={previewPaneDocumentClasses}>
              <div className={documentPageClasses}>
                <p>A short document.</p>
              </div>
            </PreviewPane>
          )}
        </div>
      );
      const { rerender } = render(fixture(false));
      const live = size(
        requireElement(screen.getByTestId('fixture'), '.max-w-2xl'),
      );
      rerender(fixture(true));
      expect(
        size(requireElement(screen.getByTestId('fixture'), '.max-w-2xl')),
      ).toEqual(live);
      expect(screen.getByTestId('fixture').scrollHeight).toBe(500);
    },
  );
});
