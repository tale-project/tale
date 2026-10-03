import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RouterContext } from '@/app/router';
import { defineAbilityFor } from '@/lib/permissions/ability';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

const { ensureAdaptedQueryData, loaderAbility, cachedAbility } = vi.hoisted(
  () => ({
    ensureAdaptedQueryData: vi.fn(),
    loaderAbility: vi.fn(),
    cachedAbility: vi.fn(),
  }),
);

vi.mock('@/app/lib/backend/prefetch', () => ({ ensureAdaptedQueryData }));
vi.mock('@/app/lib/loader-preload', () => ({ loaderAbility, cachedAbility }));

import { loadAutomationName } from './load-automation-name';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both reads it makes are mocked above
const context = { queryClient: {} } as unknown as RouterContext;

beforeEach(() => {
  ensureAdaptedQueryData.mockReset();
  loaderAbility.mockReset();
  cachedAbility.mockReset();
  // A cold deep link unless a case says otherwise: nothing cached yet.
  cachedAbility.mockReturnValue(null);
  ensureAdaptedQueryData.mockResolvedValue({ presentation: undefined });
});

// Without a declared presentation the name is the slug's title — whatever
// that reads, the title must carry it for an author.
const MAIL_SYNC = automationDisplayName(undefined, 'mail-sync', 'en');

// The document title of an automation page. Only Owners, Admins and
// Developers may use Automations: everyone else gets the denial, and the
// browser tab must not name the automation behind it either.
describe('loadAutomationName', () => {
  it.each(['owner', 'admin', 'developer'])(
    'names the automation for the %s role',
    async (role) => {
      loaderAbility.mockResolvedValue(defineAbilityFor(role));
      await expect(
        loadAutomationName(context, 'org-1', 'mail-sync'),
      ).resolves.toBe(MAIL_SYNC);
    },
  );

  it.each(['editor', 'member'])(
    'names nothing for the %s role',
    async (role) => {
      loaderAbility.mockResolvedValue(defineAbilityFor(role));
      await expect(
        loadAutomationName(context, 'org-1', 'mail-sync'),
      ).resolves.toBeUndefined();
    },
  );

  it('reads nothing when the cached role already denies the viewer', async () => {
    cachedAbility.mockReturnValue(defineAbilityFor('member'));
    await expect(
      loadAutomationName(context, 'org-1', 'mail-sync'),
    ).resolves.toBeUndefined();
    expect(ensureAdaptedQueryData).not.toHaveBeenCalled();
    expect(loaderAbility).not.toHaveBeenCalled();
  });

  it('names nothing when the role cannot be read', async () => {
    loaderAbility.mockResolvedValue(null);
    await expect(
      loadAutomationName(context, 'org-1', 'mail-sync'),
    ).resolves.toBeUndefined();
  });

  it('reads the automation by the name the URL segment carries', async () => {
    loaderAbility.mockResolvedValue(defineAbilityFor('developer'));
    await loadAutomationName(context, 'org-1', 'billing__dunning');
    expect(ensureAdaptedQueryData).toHaveBeenCalledWith(
      context.queryClient,
      'automations/queries:getAutomation',
      { organizationId: 'org-1', name: 'billing/dunning' },
    );
  });

  it('falls back to the generic title when the automation cannot be read', async () => {
    loaderAbility.mockResolvedValue(defineAbilityFor('developer'));
    ensureAdaptedQueryData.mockRejectedValue(new Error('not found'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      loadAutomationName(context, 'org-1', 'mail-sync'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
