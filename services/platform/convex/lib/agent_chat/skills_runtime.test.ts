import { describe, expect, it, vi } from 'vitest';

import {
  buildSkillContext,
  mergeSkillDependencies,
  MAX_TRANSITIVE_TOOLS,
  type AgentConfigForSkills,
  type SkillSnapshot,
} from './skills_runtime';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCtx(runActionMock?: ReturnType<typeof vi.fn>) {
  return {
    runAction: runActionMock ?? vi.fn(),
    runQuery: vi.fn(),
    runMutation: vi.fn(),
  } as unknown as Parameters<typeof buildSkillContext>[0];
}

function emptySnapshot(): SkillSnapshot {
  return {
    entries: [],
    bySlug: new Map(),
    resolved: new Map(),
    builtInTools: {},
    systemPromptAppend: '',
  };
}

function snapshotWith(
  bindings: Array<{
    slug: string;
    toolNames?: string[];
    integrationBindings?: string[];
    workflowBindings?: string[];
  }>,
): SkillSnapshot {
  const resolved = new Map(
    bindings.map((b) => [
      b.slug,
      {
        slug: b.slug,
        versionHash: 'h'.repeat(64),
        toolNames: b.toolNames ?? [],
        integrationBindings: b.integrationBindings ?? [],
        workflowBindings: b.workflowBindings ?? [],
      },
    ]),
  );
  // Mirror production: bySlug and resolved are populated in lockstep for
  // every successfully-loaded skill. See skills_runtime.ts:181-234.
  const entries = bindings.map((b) => ({
    slug: b.slug,
    description: 'desc',
    disableModelInvocation: false,
    body: 'body',
    versionHashLive: 'h'.repeat(64),
    versionHashSnapshot: 'h'.repeat(64),
    driftDetected: false,
    declaredPackages: { python: [], node: [] },
    files: [],
    executableFiles: [],
  }));
  return {
    entries,
    bySlug: new Map(entries.map((e) => [e.slug, e])),
    resolved,
    builtInTools: {},
    systemPromptAppend: 'x',
  };
}

// ---------------------------------------------------------------------------
// N=0 zero-cost contract
// ---------------------------------------------------------------------------

describe('buildSkillContext — N=0 zero-cost short-circuit', () => {
  it('does not call ctx.runAction when skillBindingsResolved is undefined', async () => {
    const runAction = vi.fn();
    const ctx = makeCtx(runAction);
    const agentConfig: AgentConfigForSkills = {};

    const snap = await buildSkillContext(ctx, agentConfig, 'default');

    expect(runAction).not.toHaveBeenCalled();
    expect(snap.entries).toEqual([]);
    expect(snap.builtInTools).toEqual({});
    expect(snap.systemPromptAppend).toBe('');
  });

  it('does not call ctx.runAction when skillBindingsResolved is empty', async () => {
    const runAction = vi.fn();
    const ctx = makeCtx(runAction);
    const agentConfig: AgentConfigForSkills = { skillBindingsResolved: [] };

    const snap = await buildSkillContext(ctx, agentConfig, 'default');

    expect(runAction).not.toHaveBeenCalled();
    expect(snap.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeSkillDependencies
// ---------------------------------------------------------------------------

describe('mergeSkillDependencies', () => {
  it('returns the agentConfig unchanged when no skills bound', () => {
    const cfg: AgentConfigForSkills = { convexToolNames: ['web'] };
    const merged = mergeSkillDependencies(cfg, emptySnapshot());
    expect(merged).toBe(cfg);
  });

  it('unions skill-declared tools with agent toolNames (dedup)', () => {
    const cfg: AgentConfigForSkills = {
      convexToolNames: ['rag_search', 'web'],
    };
    const snap = snapshotWith([
      { slug: 'a', toolNames: ['rag_search', 'pdf'] },
      { slug: 'b', toolNames: ['pdf', 'docx'] },
    ]);
    const merged = mergeSkillDependencies(cfg, snap);
    expect(new Set(merged.convexToolNames)).toEqual(
      new Set(['rag_search', 'web', 'pdf', 'docx']),
    );
  });

  it('unions integrationBindings + workflowBindings the same way', () => {
    const cfg: AgentConfigForSkills = {
      integrationBindings: ['slack'],
      workflowBindings: ['summarize'],
    };
    const snap = snapshotWith([
      {
        slug: 'a',
        integrationBindings: ['slack', 'github'],
        workflowBindings: ['summarize', 'classify'],
      },
    ]);
    const merged = mergeSkillDependencies(cfg, snap);
    expect(new Set(merged.integrationBindings)).toEqual(
      new Set(['slack', 'github']),
    );
    expect(new Set(merged.workflowBindings)).toEqual(
      new Set(['summarize', 'classify']),
    );
  });

  it('throws when post-merge tool count exceeds MAX_TRANSITIVE_TOOLS', () => {
    const tools: string[] = [];
    for (let i = 0; i < MAX_TRANSITIVE_TOOLS + 1; i += 1) {
      tools.push(`tool-${i}`);
    }
    const cfg: AgentConfigForSkills = { convexToolNames: [] };
    const snap = snapshotWith([{ slug: 'huge', toolNames: tools }]);
    expect(() => mergeSkillDependencies(cfg, snap)).toThrow(
      /transitive tool cap/i,
    );
  });

  it('counts delegates against the same cap', () => {
    // Agent has 30 delegates, skill adds 5 tools → 35 > 32 cap
    const cfg: AgentConfigForSkills = {
      delegateSlugs: Array.from({ length: 30 }, (_, i) => `agent-${i}`),
    };
    const snap = snapshotWith([
      { slug: 'a', toolNames: ['t1', 't2', 't3', 't4', 't5'] },
    ]);
    expect(() => mergeSkillDependencies(cfg, snap)).toThrow(
      /transitive tool cap/i,
    );
  });

  it('allows exactly MAX_TRANSITIVE_TOOLS total', () => {
    // Three built-in skill tools (expand_skill, read_skill_file, skill_run)
    // count against the same cap (see skills_runtime.ts:300-303), so the
    // largest legal skill-tool count is MAX_TRANSITIVE_TOOLS - 3.
    const BUILT_IN_SKILL_TOOL_COUNT = 3;
    const tools = Array.from(
      { length: MAX_TRANSITIVE_TOOLS - BUILT_IN_SKILL_TOOL_COUNT },
      (_, i) => `tool-${i}`,
    );
    const cfg: AgentConfigForSkills = { convexToolNames: [] };
    const snap = snapshotWith([{ slug: 'a', toolNames: tools }]);
    expect(() => mergeSkillDependencies(cfg, snap)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Snapshot drift detection (the security-critical path)
// ---------------------------------------------------------------------------

describe('buildSkillContext — snapshot-vs-live drift', () => {
  it('logs a warning when live versionHash differs from snapshot', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runAction = vi.fn().mockResolvedValue({
      ok: true,
      slug: 'code-reviewer',
      meta: {
        description: 'review code',
        packages: { python: [], node: [] },
      },
      body: 'do the thing',
      // Live hash differs from the agent's snapshot hash
      versionHash: 'b'.repeat(64),
      files: [],
      executableFiles: [],
    });
    const ctx = makeCtx(runAction);
    const agentConfig: AgentConfigForSkills = {
      skillBindingsResolved: [
        {
          slug: 'code-reviewer',
          versionHash: 'a'.repeat(64),
          toolNames: ['rag_search'],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    };

    const snap = await buildSkillContext(ctx, agentConfig, 'default');

    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0].driftDetected).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('skill_drift'),
    );
    warnSpy.mockRestore();
  });

  it('logs skill_dangling and skips when readSkillForExecution fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runAction = vi.fn().mockResolvedValue({
      ok: false,
      error: 'not_found',
      message: 'gone',
    });
    const ctx = makeCtx(runAction);
    const agentConfig: AgentConfigForSkills = {
      skillBindingsResolved: [
        {
          slug: 'missing',
          versionHash: 'a'.repeat(64),
          toolNames: [],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    };

    const snap = await buildSkillContext(ctx, agentConfig, 'default');

    expect(snap.entries).toEqual([]);
    expect(snap.systemPromptAppend).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('skill_dangling'),
    );
    warnSpy.mockRestore();
  });

  it('uses the snapshot dependency set, NOT live frontmatter, when merging', async () => {
    // Snapshot says toolNames: ['rag_search'].
    // Live (returned by readSkillForExecution) is irrelevant for merging —
    // mergeSkillDependencies reads the snapshot.resolved map. This test
    // proves the design: post-bind skill edits cannot smuggle in new
    // transitive dependencies.
    const cfg: AgentConfigForSkills = {
      skillBindingsResolved: [
        {
          slug: 'pdf-extractor',
          versionHash: 'a'.repeat(64),
          toolNames: ['rag_search'],
          integrationBindings: [],
          workflowBindings: [],
        },
      ],
    };
    const snap = snapshotWith([
      // Even though the runtime snapshot's `resolved` for 'pdf-extractor'
      // matches the agent's binding, we craft a different one here to show
      // mergeSkillDependencies uses snapshot.resolved verbatim.
      { slug: 'pdf-extractor', toolNames: ['rag_search', 'pdf'] },
    ]);
    const merged = mergeSkillDependencies(cfg, snap);
    expect(new Set(merged.convexToolNames)).toEqual(
      new Set(['rag_search', 'pdf']),
    );
  });
});
