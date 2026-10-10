// @vitest-environment node

/**
 * A `knowledge.search` step searches AS ITS RUN: the knowledge the run's
 * agent steps read (its project, its automation's bound projects, or the
 * hub) and the run's spend subject, both read off the run — and a refused
 * search becomes a refusal the step can explain.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import { ChatBudgetExceededError } from '../chat/budget-admission.ts';

const { searchKnowledgeForOrg, KnowledgeError } = vi.hoisted(() => {
  class FakeKnowledgeError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    searchKnowledgeForOrg: vi.fn(),
    KnowledgeError: FakeKnowledgeError,
  };
});

vi.mock('./service.ts', () => ({ searchKnowledgeForOrg, KnowledgeError }));

import { knowledgeSearchForRuns } from './automation-search.ts';

interface RunRow {
  name: string;
  projectId: string | null;
  startedBy: string;
}

/**
 * Scripted `sql` for the run's reads: the run row (its binding, and its
 * starter for the spend subject), the automation's bindings, and the
 * project rows. Everything else answers with no rows.
 */
function fakeSql(script: {
  run?: RunRow;
  bindings?: string[];
  projects?: Array<{ id: string; teamIds: string[] }>;
}): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    const run = script.run;
    const bindings = script.bindings ?? [];
    if (text.includes('started_by')) {
      return Promise.resolve(
        run
          ? [
              {
                startedBy: run.startedBy,
                name: run.name,
                apiKeyId: null,
                projectId: run.projectId,
                boundProjectIds: bindings.length > 0 ? bindings : null,
              },
            ]
          : [],
      );
    }
    if (text.includes('FROM app.automation_runs')) {
      return Promise.resolve(
        run ? [{ name: run.name, projectId: run.projectId }] : [],
      );
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      return Promise.resolve(bindings.map((projectId) => ({ projectId })));
    }
    if (text.includes('FROM app.projects')) {
      const wanted = values.find(Array.isArray) ?? [values[0]];
      return Promise.resolve(
        (script.projects ?? [])
          .filter((project) => wanted.includes(project.id))
          .map((project) => ({
            id: project.id,
            teamIds: project.teamIds,
            archivedAt: null,
          })),
      );
    }
    return Promise.resolve([]);
  };
  return Object.assign(fn, { unsafe: (text: string) => text }) as never;
}

const ARGS = {
  organizationId: 'org_1',
  runId: 'run_7',
  query: 'refund window',
  corpus: 'all' as const,
  limit: 5,
};

beforeEach(() => {
  searchKnowledgeForOrg.mockReset();
  searchKnowledgeForOrg.mockResolvedValue({ hits: [] });
});

describe('a search step searches as its run', () => {
  it('reads its project, and spends as the person who started it [CONN-R22]', async () => {
    const sql = fakeSql({
      run: { name: 'support-digest', projectId: 'p1', startedBy: 'user:ada' },
      projects: [{ id: 'p1', teamIds: ['team-support'] }],
    });
    await expect(knowledgeSearchForRuns(sql).search(ARGS)).resolves.toEqual({
      ok: true,
      hits: [],
    });
    expect(searchKnowledgeForOrg).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      spender: {
        userId: 'ada',
        agentSlug: 'support-digest',
        projectIds: ['p1'],
      },
      query: 'refund window',
      corpus: 'all',
      limit: 5,
      access: {
        teamIds: ['team-support'],
        projectIds: ['p1'],
        includeHub: true,
        archivedProjectIds: [],
      },
    });
  });

  it('reads the projects its automation is bound to when it runs for the whole organization', async () => {
    const sql = fakeSql({
      run: { name: 'weekly-faq', projectId: null, startedBy: 'trigger:t1' },
      bindings: ['p1', 'p2'],
      projects: [
        { id: 'p1', teamIds: [] },
        { id: 'p2', teamIds: [] },
      ],
    });
    await knowledgeSearchForRuns(sql).search({ ...ARGS, folder: '/Policies/' });
    expect(searchKnowledgeForOrg).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        spender: {
          userId: AUTOMATION_SUBJECT_ID,
          agentSlug: 'weekly-faq',
          projectIds: ['p1', 'p2'],
        },
        folder: '/Policies/',
        access: expect.objectContaining({ projectIds: ['p1', 'p2'] }),
      }),
    );
  });

  it('reads only the hub for an automation bound to no project [CONN-R22]', async () => {
    const sql = fakeSql({
      run: { name: 'org-digest', projectId: null, startedBy: 'trigger:t1' },
    });
    await knowledgeSearchForRuns(sql).search(ARGS);
    expect(searchKnowledgeForOrg).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        access: {
          teamIds: [],
          projectIds: [],
          includeHub: true,
          archivedProjectIds: [],
        },
      }),
    );
  });

  it.each([
    ['is gone', {}],
    [
      'is pinned to a deleted project',
      {
        run: { name: 'support-digest', projectId: 'p9', startedBy: 'user:ada' },
      },
    ],
  ])('searches nothing for a run that %s', async (_case, script) => {
    await expect(
      knowledgeSearchForRuns(fakeSql(script)).search(ARGS),
    ).resolves.toEqual({ ok: false, refusal: { kind: 'no_scope' } });
    expect(searchKnowledgeForOrg).not.toHaveBeenCalled();
  });

  it('hands each hit on with where it came from', async () => {
    searchKnowledgeForOrg.mockResolvedValue({
      hits: [
        {
          text: 'Refunds take ten working days.',
          corpus: 'documents',
          source: {
            ref: 'blob_1',
            title: 'Refund policy',
            documentId: 'doc_1',
            projectId: 'p1',
          },
          fusedScore: 0.03,
          similarity: 0.8,
        },
        {
          text: 'Our help centre explains refunds.',
          corpus: 'web',
          source: {
            ref: 'https://help.example.com/refunds',
            title: null,
            url: 'https://help.example.com/refunds',
            projectId: null,
          },
          fusedScore: 0.01,
        },
      ],
    });
    const sql = fakeSql({
      run: { name: 'support-digest', projectId: 'p1', startedBy: 'user:ada' },
      projects: [{ id: 'p1', teamIds: [] }],
    });
    await expect(knowledgeSearchForRuns(sql).search(ARGS)).resolves.toEqual({
      ok: true,
      hits: [
        {
          text: 'Refunds take ten working days.',
          title: 'Refund policy',
          source: 'documents',
          documentId: 'doc_1',
          projectId: 'p1',
          score: 0.03,
          similarity: 0.8,
        },
        {
          text: 'Our help centre explains refunds.',
          title: null,
          source: 'web',
          url: 'https://help.example.com/refunds',
          score: 0.01,
        },
      ],
    });
  });
});

describe('a refused search', () => {
  const sql = fakeSql({
    run: { name: 'support-digest', projectId: null, startedBy: 'user:ada' },
  });

  it.each([
    [
      new KnowledgeError('EMBEDDING_NOT_CONFIGURED', 'No embedding model'),
      { kind: 'not_configured' },
    ],
    [
      new KnowledgeError(
        'EMBEDDING_UPSTREAM_ERROR',
        'The provider failed: 502',
      ),
      { kind: 'unavailable', detail: 'The provider failed: 502' },
    ],
    [
      new KnowledgeError('BUDGET_EXCEEDED', 'Usage limit reached.'),
      { kind: 'budget', detail: 'Usage limit reached.' },
    ],
    [
      new ChatBudgetExceededError({
        code: 'BUDGET_EXCEEDED',
        message: "This project's monthly cost limit is used up.",
        scope: 'project',
        projectId: 'p1',
        limitCode: 'COST_LIMIT',
        period: 'monthly',
        used: 1000,
        limit: 1000,
        resetsAt: 1_793_491_200_000,
      }),
      {
        kind: 'budget',
        detail: "This project's monthly cost limit is used up.",
      },
    ],
  ])('says why: %s [CONN-R21]', async (error, refusal) => {
    searchKnowledgeForOrg.mockRejectedValue(error);
    await expect(knowledgeSearchForRuns(sql).search(ARGS)).resolves.toEqual({
      ok: false,
      refusal,
    });
  });

  it('lets a failure it has no words for through', async () => {
    const failure = new Error('the corpus pool is unusable');
    searchKnowledgeForOrg.mockRejectedValue(failure);
    await expect(knowledgeSearchForRuns(sql).search(ARGS)).rejects.toBe(
      failure,
    );
  });
});
