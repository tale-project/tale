// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A document the PII policy refused because its protection could not start
 * — the scrubber could not be built, typically on an image without the PII
 * data tree — used to stay Failed until an admin saved the policy. The pass
 * asserted here queues it again on its own once this process can build the
 * scrubber: the documents themselves say what was refused, so it also works
 * in the new process of a redeploy that never saw the failure.
 *
 * What is asserted is WHO the pass asks and HOW: the selection itself is the
 * policy save's (`requeuePiiScanFailedDocuments`), whose options are pinned
 * in `requeue-embedding.test.ts`.
 */

const {
  readGovernancePolicy,
  scrubberForPolicy,
  requeuePiiScanFailedDocuments,
} = vi.hoisted(() => ({
  readGovernancePolicy: vi.fn(),
  scrubberForPolicy: vi.fn(),
  requeuePiiScanFailedDocuments: vi.fn(),
}));

vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicy,
}));

vi.mock('../../core/knowledge/pii_gate.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/knowledge/pii_gate.ts')
  >()),
  scrubberForPolicy,
}));

vi.mock('./service.ts', () => ({ requeuePiiScanFailedDocuments }));

const { requeuePiiUnavailableDocuments } = await import('./pii-scan-resume.ts');

const ENABLED = { enabled: true, mode: 'mask', enabledPatterns: ['email'] };
const DISABLED = { ...ENABLED, enabled: false };
/** A scrubber that was built: the pass never runs it. */
const BUILT = { scrub: vi.fn() };

/** Answers the organization walk with `slugs`, ids in the same order. */
function fakeSql(slugs: string[]) {
  const statements: string[] = [];
  const sql = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    return Promise.resolve(
      slugs.map((slug, index) => ({ id: `org-${index + 1}`, slug })),
    );
  };
  return { sql: sql as never, statements };
}

/** The organizations the pass queued documents for, with its options. */
function asked() {
  return requeuePiiScanFailedDocuments.mock.calls.map(
    ([, organization, options]) => [organization.orgSlug, options],
  );
}

describe('requeuePiiUnavailableDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readGovernancePolicy.mockResolvedValue(ENABLED);
    scrubberForPolicy.mockImplementation((config: { enabled: boolean }) =>
      config.enabled ? BUILT : null,
    );
    requeuePiiScanFailedDocuments.mockResolvedValue({ requeued: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queues again what each organization refused because its protection could not start, and only that [KNOW-R9]', async () => {
    requeuePiiScanFailedDocuments
      .mockResolvedValueOnce({ requeued: 3 })
      .mockResolvedValueOnce({ requeued: 2 });
    const { sql, statements } = fakeSql(['acme', 'beta']);

    const total = await requeuePiiUnavailableDocuments(sql);

    expect(total).toBe(5);
    expect(statements[0]).toContain('FROM "organization"');
    // A part that could not be scanned whole fails again for the same text
    // and policy: it stays with the policy save and Retry indexing. Bodies
    // whose job still waits or runs are not queued a second time.
    const options = {
      cause: 'unavailable',
      limit: 250,
      skipQueuedBodies: true,
    };
    expect(asked()).toEqual([
      ['acme', options],
      ['beta', options],
    ]);
    expect(requeuePiiScanFailedDocuments.mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      orgSlug: 'acme',
    });
    expect(readGovernancePolicy).toHaveBeenCalledWith('acme', 'pii_config');
  });

  it('leaves an organization whose policy is off, absent, unreadable or still cannot build its scrubber [KNOW-R9]', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const policies: Record<string, unknown> = {
      off: DISABLED,
      absent: null,
      unreadable: { enabled: 'yes' },
      unbuilt: { ...ENABLED, enabledPatterns: ['phone'] },
      acme: ENABLED,
    };
    readGovernancePolicy.mockImplementation(async (slug: string) => {
      return policies[slug];
    });
    scrubberForPolicy.mockImplementation(
      (config: { enabled: boolean; enabledPatterns: string[] }) =>
        !config.enabled
          ? null
          : config.enabledPatterns.includes('phone')
            ? 'unavailable'
            : BUILT,
    );
    const { sql } = fakeSql(['off', 'absent', 'unreadable', 'unbuilt', 'acme']);

    await requeuePiiUnavailableDocuments(sql);

    // A disabled policy's save already queued them; a policy that cannot
    // be read is not taken for a disabled one; a scrubber that still fails
    // would refuse them again.
    expect(asked().map(([slug]) => slug)).toEqual(['acme']);
  });

  it('keeps each organization to its share and the pass to its bound [KNOW-R9]', async () => {
    // Each organization has more waiting than the pass gives it.
    requeuePiiScanFailedDocuments.mockImplementation(
      async (_sql: unknown, _org: unknown, options: { limit: number }) => ({
        requeued: Math.min(options.limit, 240),
      }),
    );
    const { sql } = fakeSql(['a', 'b', 'c', 'd', 'e', 'f']);

    const total = await requeuePiiUnavailableDocuments(sql);

    expect(total).toBe(1_000);
    expect(
      asked().map(([slug, options]) => [
        slug,
        (options as { limit: number }).limit,
      ]),
    ).toEqual([
      ['a', 250],
      ['b', 250],
      ['c', 250],
      ['d', 250],
      ['e', 40],
    ]);
  });

  it('goes on past an organization that fails, and says so [KNOW-R9]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    readGovernancePolicy.mockImplementation(async (slug: string) => {
      if (slug === 'unread') throw new Error('config store unavailable');
      return ENABLED;
    });
    requeuePiiScanFailedDocuments.mockImplementation(
      async (_sql: unknown, organization: { orgSlug: string }) => {
        if (organization.orgSlug === 'down') {
          throw new Error('knowledge database unavailable');
        }
        return { requeued: 1 };
      },
    );
    const { sql } = fakeSql(['unread', 'down', 'acme']);

    const total = await requeuePiiUnavailableDocuments(sql);

    expect(total).toBe(1);
    expect(asked().map(([slug]) => slug)).toEqual(['down', 'acme']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not resume the PII scans'),
      { organizationId: 'org-2' },
      expect.objectContaining({ message: 'knowledge database unavailable' }),
    );
  });

  it('stops between organizations once its job is aborted', async () => {
    const controller = new AbortController();
    requeuePiiScanFailedDocuments.mockImplementation(async () => {
      controller.abort();
      return { requeued: 4 };
    });
    const { sql } = fakeSql(['acme', 'beta']);

    const total = await requeuePiiUnavailableDocuments(sql, {
      signal: controller.signal,
    });

    expect(total).toBe(4);
    expect(asked().map(([slug]) => slug)).toEqual(['acme']);
  });
});
