import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

import { useProjectViewTabs } from './use-project-view-tabs';

let localeFixture = 'en';
let boundFixture: Array<{ automationSlug: string }> = [];
let installedFixture: Array<{
  slug: string;
  scope?: 'org' | 'project';
  views: Array<Record<string, unknown>>;
}> = [];

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: localeFixture }),
}));

vi.mock('./use-install-state', () => ({
  useProjectAutomations: () => ({
    automations: boundFixture,
    isLoading: false,
  }),
}));

vi.mock('./use-automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-automations')>()),
  useAutomations: () => ({ automations: installedFixture, isLoading: false }),
}));

const ORG = 'org_test';
const PROJECT = 'jd7project000000000000000' as Id<'projects'>;

describe('useProjectViewTabs', () => {
  beforeEach(() => {
    localeFixture = 'en';
    boundFixture = [];
    installedFixture = [];
  });

  it('yields one tab per view of every bound project-scoped automation', () => {
    boundFixture = [{ automationSlug: 'vat-return-desk' }];
    installedFixture = [
      {
        slug: 'vat-return-desk',
        scope: 'project',
        views: [
          { id: 'desk', title: 'Desk' },
          { id: 'reports', title: 'Reports' },
        ],
      },
    ];
    const { result } = renderHook(() => useProjectViewTabs(ORG, PROJECT));
    expect(result.current).toEqual([
      {
        label: 'Desk',
        href: `/dashboard/${ORG}/projects/${PROJECT}/views/vat-return-desk/desk`,
        matchMode: 'exact',
      },
      {
        label: 'Reports',
        href: `/dashboard/${ORG}/projects/${PROJECT}/views/vat-return-desk/reports`,
        matchMode: 'exact',
      },
    ]);
  });

  it('resolves the pack i18n title for the active locale', () => {
    localeFixture = 'de';
    boundFixture = [{ automationSlug: 'vat-return-desk' }];
    installedFixture = [
      {
        slug: 'vat-return-desk',
        scope: 'project',
        views: [{ id: 'desk', title: 'Desk', i18n: { de: { title: 'Pult' } } }],
      },
    ];
    const { result } = renderHook(() => useProjectViewTabs(ORG, PROJECT));
    expect(result.current[0]?.label).toBe('Pult');
  });

  it('falls back to the start-cased route id for untitled and invalid views', () => {
    boundFixture = [{ automationSlug: 'vat-return-desk' }];
    installedFixture = [
      {
        slug: 'vat-return-desk',
        scope: 'project',
        views: [
          { id: 'quarter-desk' },
          { id: 'broken-view', error: { message: 'bad json' } },
        ],
      },
    ];
    const { result } = renderHook(() => useProjectViewTabs(ORG, PROJECT));
    expect(result.current.map((tab) => tab.label)).toEqual([
      'Quarter Desk',
      'Broken View',
    ]);
  });

  it('skips bindings whose automation is uninstalled or not project-scoped', () => {
    boundFixture = [{ automationSlug: 'gone' }, { automationSlug: 'org-wide' }];
    installedFixture = [
      { slug: 'org-wide', scope: 'org', views: [{ id: 'inbox' }] },
    ];
    const { result } = renderHook(() => useProjectViewTabs(ORG, PROJECT));
    expect(result.current).toEqual([]);
  });
});
