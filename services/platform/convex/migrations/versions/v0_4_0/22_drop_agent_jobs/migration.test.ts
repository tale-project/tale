// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_0/22_drop_agent_jobs';

// The harness runs the standard ritual automatically: the destructive gate
// (refused without allowDestructive), up through the real runner, snapshot
// hygiene (rows snapshotted after up, snapshots consumed by down), handler
// idempotency, and down restoring the seed digest byte-for-byte.
defineMigrationTest({
  id: '0.4.0/22_drop_agent_jobs',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx) {
    await ctx.db.insert('agentJobs', {
      organizationId: 'org_0',
      threadId: 'thread_1',
      jobThreadId: 'jobthread_1',
      parentAgentSlug: 'assistant',
      name: 'Research task',
      description: 'Investigate the reported regression.',
      status: 'running',
      specVersion: 1,
      spec: {
        instructions: 'Investigate and summarize.',
        input: 'The regression appears after the last deploy.',
        requestedTools: [],
        effectiveTools: [],
        skills: [],
        integrations: [],
        model: 'anthropic/claude-sonnet-4',
        narrowed: { tools: [], skills: [], integrations: [] },
      },
      progress: [],
      recentOpIds: [],
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      startedAt: 1_717_000_100_000,
    });
    await ctx.db.insert('agentJobs', {
      organizationId: 'org_1',
      threadId: 'thread_2',
      jobThreadId: 'jobthread_2',
      toolCallId: 'tool-call-2',
      parentAgentSlug: 'writer',
      name: 'Draft summary',
      description: 'Summarize the findings.',
      status: 'completed',
      specVersion: 1,
      spec: {
        instructions: 'Write a concise summary.',
        input: 'Findings attached.',
        methodologySlug: 'concise-summary',
        requestedTools: ['web_search'],
        effectiveTools: ['web_search'],
        skills: ['writing'],
        integrations: [],
        modelTier: 'fast',
        model: 'anthropic/claude-haiku',
        provider: 'anthropic',
        narrowed: { tools: [], skills: [], integrations: [] },
      },
      progress: [
        {
          id: 'p1',
          content: 'Gathered findings',
          status: 'done',
          createdAt: 1_717_000_210_000,
          updatedAt: 1_717_000_220_000,
        },
      ],
      recentOpIds: ['op-1'],
      resultText: 'Summary complete.',
      inputTokens: 800,
      outputTokens: 300,
      costCents: 2,
      startedAt: 1_717_000_200_000,
      completedAt: 1_717_000_260_000,
      durationMs: 60000,
    });
  },

  async expectUp(world) {
    const rows = await world.run((ctx) => ctx.db.query('agentJobs').collect());
    expect(rows).toHaveLength(0);

    // One snapshot per deleted row, carrying the full legacy payload.
    const snaps = await world.run(
      async (ctx) =>
        (await ctx.db
          .query('migrationSnapshots')
          .withIndex(
            'by_migration',
            (q: { eq: (f: string, v: string) => unknown }) =>
              q.eq('migrationId', world.meta.id),
          )
          .collect()) as Array<Record<string, unknown>>,
    );
    expect(snaps).toHaveLength(2);
    expect(
      snaps.map((s) => (s.payload as { name: string }).name).sort(),
    ).toEqual(['Draft summary', 'Research task']);
  },
});
