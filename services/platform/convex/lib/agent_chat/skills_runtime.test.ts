import { describe, expect, it, vi } from 'vitest';

import { buildSkillContext } from './skills_runtime';

function makeOkRead(
  slug: string,
  description = `desc of ${slug}`,
  opts: { disableModelInvocation?: boolean } = {},
) {
  return {
    ok: true as const,
    slug,
    meta: {
      description,
      disableModelInvocation: opts.disableModelInvocation === true,
    },
    body: `body of ${slug}`,
    versionHash: 'a'.repeat(64),
    files: [],
  };
}

function makeCtx(opts: {
  listResult: string[] | Error;
  reads?: Record<string, ReturnType<typeof makeOkRead>>;
}) {
  // Dispatch on args shape: readSkillForExecution carries a `slug`, the
  // list action only carries `orgSlug`. The Convex `internal.*` refs are
  // opaque objects we can't stringify in unit-test land.
  const runAction = vi.fn(async (_ref: unknown, args: unknown) => {
    const a = (args ?? {}) as { slug?: string };
    if (a.slug !== undefined) {
      return opts.reads?.[a.slug] ?? { ok: false };
    }
    if (opts.listResult instanceof Error) throw opts.listResult;
    return opts.listResult;
  });
  return { runAction } as unknown as Parameters<typeof buildSkillContext>[0];
}

describe('buildSkillContext binding gate', () => {
  it('returns empty snapshot when boundSlugs is undefined — no list call', async () => {
    const ctx = makeCtx({ listResult: ['foo'] });
    const snap = await buildSkillContext(ctx, 'org', undefined);
    expect(snap.entries).toEqual([]);
    expect(snap.systemPromptAppend).toBe('');
    expect(Object.keys(snap.builtInTools)).toEqual([]);
    expect(
      (ctx as unknown as { runAction: ReturnType<typeof vi.fn> }).runAction,
    ).not.toHaveBeenCalled();
  });

  it('returns empty snapshot when boundSlugs is empty — no list call', async () => {
    const ctx = makeCtx({ listResult: ['foo'] });
    const snap = await buildSkillContext(ctx, 'org', []);
    expect(snap.entries).toEqual([]);
    expect(
      (ctx as unknown as { runAction: ReturnType<typeof vi.fn> }).runAction,
    ).not.toHaveBeenCalled();
  });

  it('loads only bound slugs that exist in the org', async () => {
    const ctx = makeCtx({
      listResult: ['foo', 'bar', 'baz'],
      reads: { foo: makeOkRead('foo'), bar: makeOkRead('bar') },
    });
    const snap = await buildSkillContext(ctx, 'org', ['foo', 'bar']);
    expect(snap.entries.map((e) => e.slug).sort()).toEqual(['bar', 'foo']);
    expect(snap.builtInTools).toHaveProperty('expand_skill');
    expect(snap.builtInTools).toHaveProperty('read_skill_file');
  });

  it('silently drops bound slugs that are not in the org', async () => {
    const ctx = makeCtx({
      listResult: ['foo'],
      reads: { foo: makeOkRead('foo') },
    });
    const snap = await buildSkillContext(ctx, 'org', ['foo', 'ghost']);
    expect(snap.entries.map((e) => e.slug)).toEqual(['foo']);
  });

  it('returns empty snapshot when no bound slug intersects the org list', async () => {
    const ctx = makeCtx({ listResult: ['foo'] });
    const snap = await buildSkillContext(ctx, 'org', ['ghost']);
    expect(snap.entries).toEqual([]);
    expect(Object.keys(snap.builtInTools)).toEqual([]);
  });

  it('propagates the rejection when the list call throws', async () => {
    // Silent fall-through to an empty snapshot hides real failures from
    // the operator and contradicts the hard-allowlist promise — match
    // the behavior of sibling builders (integrations / workflows / mcp)
    // and let the turn fail loudly.
    const ctx = makeCtx({ listResult: new Error('boom') });
    await expect(buildSkillContext(ctx, 'org', ['foo'])).rejects.toThrow(
      'boom',
    );
  });

  it('injects "before reaching for a generic tool" guidance into systemPromptAppend', async () => {
    // Rule 7 in the seed chat-agent prompt used to hardcode this guidance;
    // it now lives in the runtime template so every agent that binds at
    // least one skill gets the directive uniformly.
    const ctx = makeCtx({
      listResult: ['foo'],
      reads: { foo: makeOkRead('foo') },
    });
    const snap = await buildSkillContext(ctx, 'org', ['foo']);
    expect(snap.systemPromptAppend).toContain(
      'Before reaching for a generic tool',
    );
    expect(snap.systemPromptAppend).toContain('expand_skill');
  });

  it('propagates the caller orgSlug to every internal action call', async () => {
    // Cross-tenant isolation pin: the runtime must use the orgSlug it was
    // handed and never default, cache, or substitute it. A regression that
    // "optimizes" by sharing a global skill list would silently break
    // org isolation; this test fails fast on that.
    const ctx = makeCtx({
      listResult: ['foo'],
      reads: { foo: makeOkRead('foo') },
    });
    await buildSkillContext(ctx, 'org-a', ['foo']);
    const runAction = (
      ctx as unknown as { runAction: ReturnType<typeof vi.fn> }
    ).runAction;
    expect(runAction).toHaveBeenCalled();
    for (const call of runAction.mock.calls) {
      const args = call[1] as { orgSlug?: string };
      expect(args.orgSlug).toBe('org-a');
    }
  });

  it('collapses duplicate bound slugs to a single snapshot entry', async () => {
    // Schema doesn't reject duplicates today; runtime de-dupes via Set so
    // the snapshot, prompt list, and tool registry stay consistent.
    const ctx = makeCtx({
      listResult: ['foo'],
      reads: { foo: makeOkRead('foo') },
    });
    const snap = await buildSkillContext(ctx, 'org', ['foo', 'foo']);
    expect(snap.entries.map((e) => e.slug)).toEqual(['foo']);
    expect(snap.bySlug.size).toBe(1);
  });

  it('excludes disableModelInvocation skills from the prompt list but keeps them resolvable', async () => {
    // The "hidden but callable" contract: setting disableModelInvocation
    // on a skill removes its entry from the Available Skills suffix so
    // the model won't auto-discover it, but the runtime still loads it
    // into bySlug so explicit `expand_skill` calls succeed.
    const ctx = makeCtx({
      listResult: ['hidden', 'shown'],
      reads: {
        hidden: makeOkRead('hidden', 'desc of hidden', {
          disableModelInvocation: true,
        }),
        shown: makeOkRead('shown'),
      },
    });
    const snap = await buildSkillContext(ctx, 'org', ['hidden', 'shown']);
    expect(snap.bySlug.has('hidden')).toBe(true);
    expect(snap.bySlug.has('shown')).toBe(true);
    expect(snap.systemPromptAppend).toContain('**shown**');
    expect(snap.systemPromptAppend).not.toContain('**hidden**');
  });
});
