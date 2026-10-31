// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { baseLocaleOf, type Locale } from '@tale/ui/i18n/locales';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import type { StandInMember } from '@/tests/utils/member-lookup-stand-in';
import { deMessages, enMessages, frMessages } from '@/tests/utils/messages';
import { render, screen, within } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import type { TaskActivityRow } from '../utils/task-timeline';
import { TaskModal } from './task-modal';

/**
 * A member who was removed from the organization stays on the tasks they
 * touched: as the assignee, the reviewer, the author, a comment's author and
 * in the activity. The member directory no longer lists them, and the task
 * dialog names them "Former member" in the reader's language everywhere —
 * never by their raw user id, in the text or in an accessible name (#3788).
 * The dialog reads its people through the real actor directory here; only
 * the backend's answers and the member lookup's are fixtures.
 */

/** The removed member's id, as the task still stores it. */
const GONE = 'pTqO7Cn7D9MmBLjW1v2p9yne5Ed1BxOb';
const OWNER = 'u-owner';

const state = vi.hoisted(() => ({
  members: undefined as StandInMember[] | undefined,
}));

vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => state.members,
  ),
);

const task = {
  _id: 'task-1',
  _creationTime: 0,
  organizationId: 'org-1',
  projectId: 'project-1',
  title: 'Draft the handover note',
  status: 'in_review',
  rank: 'a0',
  number: 7,
  createdBy: GONE,
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
  assigneeType: 'user',
  assigneeId: GONE,
  reviewerUserId: GONE,
} satisfies TaskDoc;

const NOW = Date.now();

/** What the removed member did, and what the owner did about them. */
const ACTIVITY: TaskActivityRow[] = [
  {
    _id: 'activity-reviewer',
    actorType: 'user',
    actorId: OWNER,
    action: 'reviewer.changed',
    toValue: GONE,
    createdAt: NOW - 1_000,
  },
  {
    _id: 'activity-assignee',
    actorType: 'user',
    actorId: OWNER,
    action: 'assignee.changed',
    fromValue: OWNER,
    toValue: GONE,
    createdAt: NOW - 2_000,
  },
  {
    _id: 'activity-created',
    actorType: 'user',
    actorId: GONE,
    action: 'created',
    toValue: 'todo',
    createdAt: NOW - 3_000,
  },
];

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    if (args === 'skip') return { data: undefined, isLoading: false };
    const answers: Record<string, unknown> = {
      'tasks/queries:getTask': {
        task,
        canEdit: true,
        canCreate: true,
        canComment: true,
        ancestors: [],
      },
      'projects/queries:getProject': {
        key: 'HAN',
        name: 'Handover board',
        canEdit: true,
      },
      'tasks/queries:getTaskReviewer': {
        reviewer: { kind: 'user', userId: GONE },
        projectReviewer: { kind: 'human_default' },
        pendingReview: null,
      },
      'tasks/queries:listTaskActivity': ACTIVITY,
      'tasks/queries:listTaskAgentRuns': [],
      'members/queries:listByOrganization': state.members,
      'automations/queries:listAutomations': [],
      'projects/queries:listProjectAgents': [],
      'projects/queries:listServingAgents': [],
      'projects/queries:listAccessibleUserIds': { orgWide: true, userIds: [] },
    };
    return { data: answers[name], isLoading: false };
  },
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { userId: OWNER, role: 'owner', isAdmin: true },
  }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  // The comment the removed member left before they went.
  useTaskDiscussion: () => ({
    comments: [
      {
        messageId: 'comment-1',
        authorType: 'user',
        authorId: GONE,
        body: 'First draft is in the shared folder.',
        createdAt: NOW - 500,
      },
    ],
    isLoading: false,
    hasEarlier: false,
    isLoadingEarlier: false,
    loadEarlier: vi.fn(),
  }),
}));
vi.mock('@/app/features/shared/files/use-file-upload', () => ({
  useFileUpload: () => ({ attachments: [], uploadingFiles: [] }),
}));
vi.mock('./task-comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-comments')>()),
  TaskCommentComposer: () => null,
  TaskCommentComposerSkeleton: () => null,
}));
vi.mock('./mention-text', () => ({
  MentionText: ({ body }: { body: string }) => <p>{body}</p>,
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));
vi.mock('./task-subject-panel', () => ({ TaskSubjectPanel: () => null }));
vi.mock('./task-automation-badge', () => ({ TaskAutomationBadge: () => null }));
vi.mock('./task-dependencies', () => ({ TaskDependencies: () => null }));

const MEMBERS = [
  {
    _id: 'member-owner',
    organizationId: 'org-1',
    userId: OWNER,
    role: 'owner' as const,
    createdAt: 0,
    displayName: 'Olive Owner',
    email: 'olive@example.com',
    twoFactorEnabled: false,
  },
];

const LOCALES = [
  ['en', enMessages, 'Former member'],
  ['de', deMessages, 'Ehemaliges Mitglied'],
  ['fr', frMessages, 'Ancien membre'],
] as const;

async function openTask(locale: Locale) {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(locale);
  saveLocale(baseLocaleOf(locale));
  await i18n.changeLanguage(locale);
  const { user } = render(
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      taskId={task._id}
    />,
  );
  return { details: await screen.findByRole('complementary'), user };
}

/** The value a details row shows beside its label (`PropertyRow`). */
function detail(details: HTMLElement, label: string): HTMLElement {
  const value = within(details)
    .getAllByText(label)
    .map((element) => element.nextElementSibling)
    .find((element) => element instanceof HTMLElement);
  if (!(value instanceof HTMLElement)) throw new Error(`no ${label} row`);
  return value;
}

/** Everything a reader or their screen reader is given: the text, and the
 * names and tips the markup carries. */
function exposedWords(): string {
  const attributes = [
    ...document.querySelectorAll('[aria-label], [title], [alt]'),
  ].flatMap((element) =>
    ['aria-label', 'title', 'alt'].map(
      (attribute) => element.getAttribute(attribute) ?? '',
    ),
  );
  return [document.body.textContent ?? '', ...attributes].join('\n');
}

beforeEach(() => {
  state.members = MEMBERS;
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete window.__ENV__;
  await forgetSavedLocale();
});

describe.each(LOCALES)(
  'TaskModal — a removed member in %s',
  (locale, messages, formerMember) => {
    it('names them a former member as assignee, reviewer and author', async () => {
      const { details } = await openTask(locale);
      const { fields } = messages.tasks;

      for (const label of [fields.assignee, fields.reviewer, fields.author]) {
        const value = detail(details, label);
        expect(value).toHaveTextContent(formerMember);
        // The avatar's accessible name says so too, with no initials of a
        // person who is not there.
        const avatar = within(value).getByRole('img', { name: formerMember });
        expect(avatar).toHaveTextContent('');
      }
    });

    it('names them a former member on their comment and in the activity', async () => {
      const { user } = await openTask(locale);
      const { activity } = messages.tasks;

      const comment = screen
        .getByText('First draft is in the shared folder.')
        .closest('li');
      if (comment === null) throw new Error('no comment');
      expect(comment).toHaveTextContent(formerMember);
      expect(
        within(comment).getByRole('img', { name: formerMember }),
      ).toBeInTheDocument();

      // The three changes fold into one line naming who made them; opened,
      // each says what it was.
      const fold = screen
        .getAllByRole('button', { expanded: false })
        .find((button) => button.textContent?.includes('Olive Owner'));
      if (fold === undefined) throw new Error('no folded activity');
      expect(fold).toHaveTextContent(`${formerMember}, Olive Owner`);
      await user.click(fold);
      for (const line of [
        `${activity.assigneeChanged}: Olive Owner → ${formerMember}`,
        `${activity.reviewerChanged}: ${formerMember}`,
      ]) {
        expect(document.body).toHaveTextContent(line);
      }
      // What they did themselves names them as its actor.
      expect(document.body).toHaveTextContent(
        new RegExp(`${activity.created}: [^·]+ · ${formerMember}`),
      );
    });

    it('never shows their raw user id, in the text or in a name', async () => {
      const { user } = await openTask(locale);
      expect(exposedWords()).not.toContain(GONE);
      // Nor in the activity a fold holds.
      for (const fold of screen.getAllByRole('button', { expanded: false })) {
        if (fold.textContent?.includes('Olive Owner')) await user.click(fold);
      }
      expect(document.body).toHaveTextContent(messages.tasks.activity.created);
      expect(exposedWords()).not.toContain(GONE);
    });
  },
);

describe('TaskModal — before the member directory answers', () => {
  it('names nobody yet: no former member, and never the id', async () => {
    state.members = undefined;
    const { details } = await openTask('en');

    expect(exposedWords()).not.toContain(GONE);
    expect(exposedWords()).not.toContain('Former member');
    // The avatars name nobody while they wait.
    expect(
      within(detail(details, 'Author')).queryByRole('img'),
    ).not.toBeInTheDocument();
  });
});
