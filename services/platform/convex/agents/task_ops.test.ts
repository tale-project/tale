/**
 * `task_ops.ts` regression coverage: the triage candidate roster
 * (`listAssignableAgents` / `listTaskCandidates`) MUST filter through the
 * same installed-&&-enabled liveness gate `assertAgentAssigneeLive`
 * (`agents/installations.ts`) checks at assign time — via
 * `listInstalledAgentsForOrg` (`agents/internal_actions.ts`, the same gate
 * `auto_route.ts` uses). Otherwise unassigned-task triage can recommend a
 * disabled/uninstalled agent that the assign mutation then rejects with a
 * `ConvexError`, erroring the triage workflow step instead of skipping the
 * candidate.
 *
 * Same direct-handler + real-temp-config-dir pattern as
 * `provision_defaults.test.ts`: `_generated/server` is mocked so
 * `internalAction(config)` returns the config, `_generated/api`'s `internal`
 * refs are opaque string keys a fake `ctx.runQuery` switches on, and agent
 * catalog files are written to a real temp `TALE_CONFIG_DIR`. Nothing here
 * mocks `internal_actions.ts` itself, so the real `listInstalledAgentsForOrg`
 * gate runs — this is what proves the wiring, not just the filter logic.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    tasks: {
      internal_queries: {
        getTaskByIdInternal: 'getTaskByIdInternal',
        getProjectByIdInternal: 'getProjectByIdInternal',
      },
    },
    agents: {
      installations: {
        listInstallStatesInternal: 'listInstallStatesInternal',
      },
    },
  },
}));

vi.mock('../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn(),
}));

const { resolveOrgSlug } = await import('../organizations/resolve_org_slug');
const { invalidateAgentListCache } = await import('./internal_actions');
const { listAssignableAgents, listTaskCandidates } = await import('./task_ops');

type InstallRow = { agentSlug: string; enabled: boolean };

// `internalAction` is mocked to return its config unchanged (see above), so
// the real export is just `{ args, returns, handler }` at runtime — the
// codegen'd `RegisteredAction` type has no `.handler`, hence the cast.
type CandidatesConfig = {
  handler: (
    ctx: never,
    args: { organizationId: string; taskId: string },
  ) => Promise<{
    candidates: { slug: string; description: string; preferred: boolean }[];
  }>;
};
const candidatesHandler = (listTaskCandidates as unknown as CandidatesConfig)
  .handler;

/** Fake `ActionCtx`: routes each mocked `internal.*` key to canned data. */
function makeCtx(
  taskId: string,
  task: Record<string, unknown> | null,
  project: Record<string, unknown> | null,
  installStates: InstallRow[],
) {
  const runQuery = vi.fn((fn: unknown, args: Record<string, unknown>) => {
    if (fn === 'getTaskByIdInternal') {
      return Promise.resolve(args.taskId === taskId ? task : null);
    }
    if (fn === 'getProjectByIdInternal') {
      return Promise.resolve(project);
    }
    if (fn === 'listInstallStatesInternal') {
      return Promise.resolve({ states: installStates, provisioned: true });
    }
    throw new Error(`unexpected runQuery call: ${String(fn)}`);
  });
  return { runQuery } as never;
}

async function writeAgent(
  configRoot: string,
  orgSlug: string,
  slug: string,
  description: string,
): Promise<void> {
  const abs = path.join(configRoot, orgSlug, 'agents', `${slug}.json`);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(
    abs,
    JSON.stringify({
      displayName: slug,
      description,
      systemInstructions: 'You are a test agent.',
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    }),
    'utf-8',
  );
}

const ORG_ID = 'org_taskops_liveness';
const ORG_SLUG = 'taskops-liveness';
const PROJECT_ID = 'project1' as never;
const TASK_ID = 'task1' as never;

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  vi.mocked(resolveOrgSlug).mockResolvedValue(ORG_SLUG);
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'task-ops-liveness-'));
  process.env.TALE_CONFIG_DIR = configRoot;
  // The agent-list index carries a 60s module-scope cache keyed by orgSlug —
  // bust it so each test's fresh temp-dir catalog is actually read.
  invalidateAgentListCache(ORG_SLUG);
  await writeAgent(
    configRoot,
    ORG_SLUG,
    'live-agent',
    'Installed and enabled.',
  );
  await writeAgent(
    configRoot,
    ORG_SLUG,
    'disabled-agent',
    'Installed but disabled.',
  );
  await writeAgent(
    configRoot,
    ORG_SLUG,
    'uninstalled-agent',
    'Never installed — no install row at all.',
  );
});

afterEach(async () => {
  if (savedConfigDir === undefined) delete process.env.TALE_CONFIG_DIR;
  else process.env.TALE_CONFIG_DIR = savedConfigDir;
  invalidateAgentListCache(ORG_SLUG);
  await rm(configRoot, { recursive: true, force: true });
});

const LIVE_ONLY: InstallRow[] = [
  { agentSlug: 'live-agent', enabled: true },
  { agentSlug: 'disabled-agent', enabled: false },
  // 'uninstalled-agent' intentionally has no row.
];

describe('listAssignableAgents — the triage roster is liveness-gated', () => {
  it('keeps the enabled agent, excludes the disabled and the uninstalled one', async () => {
    const ctx = makeCtx(TASK_ID, null, null, LIVE_ONLY);
    const roster = await listAssignableAgents(ctx, ORG_ID, ORG_SLUG);
    expect(roster.map((a) => a.slug).sort()).toEqual(['live-agent']);
  });

  it('returns nothing when no agent has an enabled install row', async () => {
    const ctx = makeCtx(TASK_ID, null, null, [
      { agentSlug: 'live-agent', enabled: false },
      { agentSlug: 'disabled-agent', enabled: false },
    ]);
    const roster = await listAssignableAgents(ctx, ORG_ID, ORG_SLUG);
    expect(roster).toEqual([]);
  });
});

describe('listTaskCandidates — the triage workflow never sees a non-live agent', () => {
  const task = { projectId: PROJECT_ID, organizationId: ORG_ID };
  const project = { organizationId: ORG_ID, agentMode: 'all' as const };

  it('excludes the disabled/uninstalled agents from the candidate list', async () => {
    const ctx = makeCtx(TASK_ID, task, project, LIVE_ONLY);
    const { candidates } = await candidatesHandler(ctx, {
      organizationId: ORG_ID,
      taskId: TASK_ID,
    });
    expect(candidates.map((c) => c.slug)).toEqual(['live-agent']);
    expect(candidates.some((c) => c.slug === 'disabled-agent')).toBe(false);
    expect(candidates.some((c) => c.slug === 'uninstalled-agent')).toBe(false);
  });

  it('never recommends a candidate the assign gate would reject: every candidate is live', async () => {
    const ctx = makeCtx(TASK_ID, task, project, [
      { agentSlug: 'live-agent', enabled: true },
      { agentSlug: 'disabled-agent', enabled: true },
    ]);
    const { candidates } = await candidatesHandler(ctx, {
      organizationId: ORG_ID,
      taskId: TASK_ID,
    });
    expect(candidates.map((c) => c.slug).sort()).toEqual([
      'disabled-agent',
      'live-agent',
    ]);
  });
});
