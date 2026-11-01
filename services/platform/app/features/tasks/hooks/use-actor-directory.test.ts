// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberLookupTarget } from '@/app/features/settings/organization/hooks/member-lookup';

import { useActorDirectory, useAssignableActors } from './use-actor-directory';

// The directory names people through the member lookup, asking it for whom
// it names, and agents from the PROJECT's user-created instances
// (`projectAgents` rows): with a project the instances are assignable and
// resolve to their names; without one no agent is assignable, and an
// unknown/foreign agent actor reads as a deleted agent. The pickers search
// the people they offer (`useAssignableMembers`): no hook here reads every
// member.

interface AgentRow {
  _id: string;
  name: string;
  harness: string;
  skills: string[];
  connectors: string[];
  managed?: boolean;
}

const PROJECT_AGENTS: AgentRow[] = [
  {
    _id: 'pa_1',
    name: 'PR Reviewer',
    harness: 'claude-code',
    skills: ['review'],
    connectors: [],
  },
  {
    _id: 'pa_2',
    name: 'Docs Writer',
    harness: 'codex',
    skills: [],
    connectors: [],
  },
];

/** The organization's standard agent, as Tale sets it up in a project. */
const MANAGED_AGENT: AgentRow = {
  _id: 'pa_std',
  name: 'Standard agent',
  harness: 'claude-code',
  skills: [],
  connectors: [],
  managed: true,
};

/** What the project's agent list answers. */
let projectAgentRows: AgentRow[] = PROJECT_AGENTS;

interface MemberRow {
  userId: string;
  displayName?: string;
  email?: string;
  role: 'member' | 'admin';
}

const MEMBERS: MemberRow[] = [
  {
    userId: 'user-1',
    displayName: 'Alex Doe',
    email: 'alex@example.com',
    role: 'member',
  },
  {
    userId: 'user-2',
    displayName: '',
    email: 'kim@example.com',
    role: 'admin',
  },
];

/** Who the members are — undefined until the member reads have answered. */
let memberRows: MemberRow[] | undefined = MEMBERS;

/** Whom the directory asked the member lookup for, and how often every
 * member was read. */
const memberReads = vi.hoisted(() => ({
  asked: new Array<MemberLookupTarget>(),
  everyMember: 0,
}));

vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => memberRows,
    memberReads.asked,
  ),
);

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => {
    memberReads.everyMember += 1;
    return { members: memberRows };
  },
}));

let standardAgent: { enabled: boolean; available: boolean } | undefined;

vi.mock('@/app/features/projects/hooks/queries', () => ({
  // Arg-sensitive like the real hook: no project id → the query skips and the
  // list is empty.
  useProjectAgents: (projectId?: string) => ({
    agents: projectId ? projectAgentRows : [],
    isLoading: false,
  }),
  // Skipped (undefined) without an organization, like the real read.
  useStandardAgent: (organizationId?: string) =>
    organizationId === undefined ? undefined : standardAgent,
}));

/** What `getProject` answers — undefined while it loads, null when the
 * project is gone or out of reach. */
let projectRead: { canEdit: boolean } | null | undefined;

/** What `listServingAgents` answers: the agents other projects' dispatches
 * put to work on this board. */
let servingAgents:
  | Array<{
      agentId: string;
      name: string;
      tools: string[];
      projectId: string;
      projectName: string;
    }>
  | undefined;
/** Whether `listServingAgents` is still being read. */
let servingLoading = false;
/** What the automation listings answer — undefined while they load. */
let automationListing: unknown[] | undefined = [];

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => ({
    isLoading:
      args !== 'skip' &&
      name === 'projects/queries:listServingAgents' &&
      servingLoading,
    data:
      args === 'skip'
        ? undefined
        : name === 'projects/queries:getProject'
          ? projectRead
          : name === 'projects/queries:listServingAgents'
            ? servingAgents
            : name === 'automations/queries:listAutomations'
              ? automationListing
              : undefined,
  }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-1' } }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

// The directory names `app` actors from the automation listing, which needs the
// reader's locale; this hook renders outside a LocaleProvider here.
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

describe('useActorDirectory — members + project-agent instances', () => {
  beforeEach(() => {
    memberReads.asked.length = 0;
    memberReads.everyMember = 0;
  });

  it('names people through the member lookup, and never reads every member', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.resolveActor('user', 'user-1')).toMatchObject({
      name: 'Alex Doe',
      isAgent: false,
      email: 'alex@example.com',
    });
    expect(result.current.resolveAssigneeId('user-2')).toBe('kim@example.com');
    // The people looked up, as the surfaces list them.
    expect(result.current.members.map((m) => m.id)).toEqual([
      'user-1',
      'user-2',
    ]);
    // Someone it has not found is asked for as they are named.
    expect(memberReads.asked).toEqual([]);
    expect(result.current.resolveActor('user', 'user-9').standing).toBe(
      'former',
    );
    expect(result.current.resolveAssigneeId('user-8')).toBe('formerMember');
    expect(memberReads.asked).toEqual([
      { userId: 'user-9' },
      { userId: 'user-8' },
    ]);
    expect(memberReads.everyMember).toBe(0);
  });

  it('exposes no assignable agents without a project', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.agents).toEqual([]);
  });

  it("lists the project's instances as assignable agents", () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.agents).toEqual([
      { type: 'agent', id: 'pa_1', name: 'PR Reviewer' },
      { type: 'agent', id: 'pa_2', name: 'Docs Writer' },
    ]);
  });

  it('resolves an instance actor to its name', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('agent', 'pa_1')).toMatchObject({
      name: 'PR Reviewer',
      isAgent: true,
    });
  });

  it('labels an agent actor the project no longer has as a deleted agent, never its raw id', () => {
    // A deleted agent's history stays on the task (its runs, its comments,
    // the activity it wrote); the id it left behind is nothing a reader can
    // look up, so the timeline says what it was instead.
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('agent', 'research-bot')).toMatchObject({
      id: 'research-bot',
      name: 'timeline.deletedAgent',
      isAgent: true,
    });
  });

  it('still names the system actor through i18n', () => {
    const { result } = renderHook(() => useActorDirectory('org-1'));
    expect(result.current.resolveActor('agent', 'system').name).toBe(
      'timeline.systemActor',
    );
  });

  it('names the project’s dispatch, never as a deleted agent', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('agent', 'dispatch').name).toBe(
      'timeline.dispatchActor',
    );
  });

  it('names and offers the agents another project’s dispatch puts to work on this board [TASK-R76]', () => {
    servingAgents = [
      {
        agentId: 'coder',
        name: 'Coder',
        tools: ['task_comment'],
        projectId: 'development',
        projectName: 'Development',
      },
    ];
    try {
      const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
      expect(result.current.agents).toContainEqual({
        type: 'agent',
        id: 'coder',
        name: 'Coder',
        tools: ['task_comment'],
        servedFrom: { projectId: 'development', projectName: 'Development' },
      });
      expect(result.current.resolveActor('agent', 'coder')).toMatchObject({
        name: 'Coder',
        isAgent: true,
      });
      expect(result.current.resolveAssigneeId('coder')).toBe('Coder');
    } finally {
      servingAgents = undefined;
    }
  });

  it('counts the agents as loading until the agents serving the board are read too', () => {
    const settled = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(settled.result.current.agentsLoading).toBe(false);
    servingLoading = true;
    try {
      const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
      expect(result.current.agentsLoading).toBe(true);
      // A mention names the project's own agents alone: it does not wait
      // for the agents serving the board.
      expect(result.current.mentionPending({ kind: 'agent', id: 'pa_1' })).toBe(
        false,
      );
      expect(result.current.mentionPending({ handle: 'pr-reviewer' })).toBe(
        false,
      );
    } finally {
      servingLoading = false;
    }
  });

  it('resolves assignee ids without a type for activity timeline rows', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveAssigneeId('user-1')).toBe('Alex Doe');
    expect(result.current.resolveAssigneeId('pa_2')).toBe('Docs Writer');
    expect(result.current.resolveAssigneeId('unknown-id')).toBe('formerMember');
  });
});

/**
 * A person the member directory does not list — a member who was removed —
 * still appears on the tasks they touched. Their id names nobody to a
 * reader, so the directory says what they are once it has answered, and
 * nothing before it has.
 */
describe('useActorDirectory — people the directory does not list', () => {
  beforeEach(() => {
    memberRows = MEMBERS;
    automationListing = [];
    servingLoading = false;
  });

  afterEach(() => {
    memberRows = MEMBERS;
    automationListing = [];
    servingLoading = false;
  });

  it('names a removed member as a former member, never by their id', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('user', 'user-gone')).toEqual({
      type: 'user',
      id: 'user-gone',
      name: 'formerMember',
      isAgent: false,
      standing: 'former',
    });
    expect(result.current.resolveAssigneeId('user-gone')).toBe('formerMember');
    // A listed member stands as no one in particular.
    expect(result.current.resolveActor('user', 'user-1').standing).toBe(
      undefined,
    );
  });

  it('names a member whose account holds no name or e-mail as a former member', () => {
    memberRows = [...MEMBERS, { userId: 'user-erased', role: 'member' }];
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('user', 'user-erased')).toMatchObject({
      name: 'formerMember',
      standing: 'former',
    });
    expect(result.current.resolveAssigneeId('user-erased')).toBe(
      'formerMember',
    );
    // The pickers' list never offers the id as a name either.
    expect(
      result.current.members.find((member) => member.id === 'user-erased'),
    ).toMatchObject({ name: 'formerMember' });
  });

  it('names nobody while the member lookup has not answered for them', () => {
    memberRows = undefined;
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.resolveActor('user', 'user-1')).toEqual({
      type: 'user',
      id: 'user-1',
      name: '',
      isAgent: false,
      standing: 'pending',
    });
    expect(result.current.resolveAssigneeId('user-1')).toBe('');
  });

  it.each([
    [
      'the agents serving the board',
      () => {
        servingLoading = true;
      },
    ],
    [
      'the automations',
      () => {
        automationListing = undefined;
      },
    ],
  ])(
    'calls an id nobody lists a former member only once %s have answered too',
    (_list, stillLoading) => {
      stillLoading();
      const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
      // It may still be one of theirs.
      expect(result.current.resolveAssigneeId('user-gone')).toBe('');
      expect(result.current.resolveAssigneeId('user-1')).toBe('Alex Doe');
    },
  );
});

/**
 * A mention names a person, an agent or an automation; until the read that
 * would name it has answered, it is not yet someone gone. A mention of a
 * person asks the member lookup for them as it is read.
 */
describe('useActorDirectory — whom a mention names', () => {
  beforeEach(() => {
    memberReads.asked.length = 0;
  });

  afterEach(() => {
    memberRows = MEMBERS;
    automationListing = [];
  });

  it('waits for the member lookup on a person, asking it for them', () => {
    memberRows = undefined;
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.mentionPending({ kind: 'user', id: 'user-1' })).toBe(
      true,
    );
    expect(result.current.mentionPending({ handle: 'alex' })).toBe(true);
    expect(result.current.memberPending({ userId: 'user-2' })).toBe(true);
    expect(memberReads.asked).toEqual([
      { userId: 'user-1' },
      { handle: 'alex' },
      { userId: 'user-2' },
    ]);
    // An agent or an automation is no person to wait for.
    expect(result.current.mentionPending({ kind: 'agent', id: 'pa_1' })).toBe(
      false,
    );
    expect(
      result.current.mentionPending({ kind: 'automation', id: 'triage' }),
    ).toBe(false);
  });

  it('waits for the automations on an automation or a handle, never on a person', () => {
    automationListing = undefined;
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(
      result.current.mentionPending({ kind: 'automation', id: 'triage' }),
    ).toBe(true);
    expect(result.current.mentionPending({ handle: 'triage' })).toBe(true);
    expect(result.current.mentionPending({ kind: 'user', id: 'user-1' })).toBe(
      false,
    );
  });

  it('names nobody pending once every read has answered', () => {
    const { result } = renderHook(() => useActorDirectory('org-1', 'proj-1'));
    expect(result.current.mentionPending({ handle: 'nobody' })).toBe(false);
    expect(
      result.current.mentionPending({ kind: 'user', id: 'user-gone' }),
    ).toBe(false);
  });
});

/**
 * The people the pickers offer are searched for what is typed, narrowed to
 * the project's audience on the server (`useAssignableMembers`): the agents'
 * list reads no member.
 */
describe('useAssignableActors — the people', () => {
  beforeEach(() => {
    memberReads.asked.length = 0;
    memberReads.everyMember = 0;
  });

  it('reads no member list, leaving the people to the pickers’ search', () => {
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.assignableAgents.map((agent) => agent.id)).toEqual([
      'pa_1',
      'pa_2',
    ]);
    expect(result.current).not.toHaveProperty('assignableMembers');
    expect(memberReads.everyMember).toBe(0);
    expect(memberReads.asked).toEqual([]);
  });
});

describe('useAssignableActors — who may add an agent', () => {
  beforeEach(() => {
    projectRead = undefined;
    standardAgent = undefined;
  });

  it('knows whether the organization’s standard agent would take work here', () => {
    standardAgent = { enabled: true, available: true };
    const on = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(on.result.current.standardAgentAvailable).toBe(true);

    standardAgent = { enabled: false, available: false };
    const off = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(off.result.current.standardAgentAvailable).toBe(false);

    // Unknown while it loads, and without a project to hand work in.
    standardAgent = undefined;
    const loading = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(loading.result.current.standardAgentAvailable).toBe(false);
    standardAgent = { enabled: true, available: true };
    const none = renderHook(() => useAssignableActors('org-1'));
    expect(none.result.current.standardAgentAvailable).toBe(false);
  });

  it('lets the project’s editors add one', () => {
    projectRead = { canEdit: true };
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.projectResolved).toBe(true);
    expect(result.current.canAddAgents).toBe(true);
  });

  it('lets a reader add none', () => {
    projectRead = { canEdit: false };
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(result.current.projectResolved).toBe(true);
    expect(result.current.canAddAgents).toBe(false);
  });

  it('knows nothing while the project loads, when it is out of reach, or without one', () => {
    const loading = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(loading.result.current.projectResolved).toBe(false);
    expect(loading.result.current.canAddAgents).toBe(false);

    projectRead = null;
    const gone = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(gone.result.current.projectResolved).toBe(false);

    projectRead = { canEdit: true };
    const none = renderHook(() => useAssignableActors('org-1'));
    expect(none.result.current.projectResolved).toBe(false);
    expect(none.result.current.canAddAgents).toBe(false);
  });
});

/**
 * The standard agent Tale sets up in a project is one of its agents, but it
 * takes a task only while the organization's standard agent can run for this
 * viewer: a start would be refused. So what a person picks from leaves it out
 * then, while the directory keeps naming it for the tasks already given to it.
 */
describe('useAssignableActors — the standard agent set up in the project', () => {
  const ids = (agents: readonly { id: string }[]) =>
    agents.map((agent) => agent.id);

  beforeEach(() => {
    projectRead = undefined;
    standardAgent = undefined;
    projectAgentRows = [MANAGED_AGENT];
  });

  afterEach(() => {
    projectAgentRows = PROJECT_AGENTS;
  });

  it('offers it while the standard agent can run for the viewer', () => {
    standardAgent = { enabled: true, available: true };
    const { result } = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(ids(result.current.assignableAgents)).toEqual(['pa_std']);
  });

  it.each([
    ['switched off', { enabled: false, available: false }],
    ['unavailable to the viewer', { enabled: true, available: false }],
    ['not answered yet', undefined],
  ])(
    'leaves it out while the standard agent is %s, and still names it',
    (_state, answer) => {
      standardAgent = answer;
      const { result } = renderHook(() =>
        useAssignableActors('org-1', 'proj-1'),
      );
      expect(result.current.assignableAgents).toEqual([]);
      // A task already given to it keeps its name on the board and timeline.
      expect(ids(result.current.agents)).toEqual(['pa_std']);
      expect(result.current.resolveActor('agent', 'pa_std')).toMatchObject({
        name: 'Standard agent',
        isAgent: true,
      });
    },
  );

  it('keeps the project’s own agents beside it either way', () => {
    projectAgentRows = [...PROJECT_AGENTS.slice(0, 1), MANAGED_AGENT];

    standardAgent = { enabled: false, available: false };
    const off = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(ids(off.result.current.assignableAgents)).toEqual(['pa_1']);

    standardAgent = { enabled: true, available: true };
    const on = renderHook(() => useAssignableActors('org-1', 'proj-1'));
    expect(ids(on.result.current.assignableAgents)).toEqual(['pa_1', 'pa_std']);
  });

  it('hands out one list until the agents or the answer change', () => {
    standardAgent = { enabled: false, available: false };
    const { result, rerender } = renderHook(() =>
      useAssignableActors('org-1', 'proj-1'),
    );
    const first = result.current.assignableAgents;
    rerender();
    expect(result.current.assignableAgents).toBe(first);

    standardAgent = { enabled: true, available: true };
    rerender();
    expect(ids(result.current.assignableAgents)).toEqual(['pa_std']);
  });
});
