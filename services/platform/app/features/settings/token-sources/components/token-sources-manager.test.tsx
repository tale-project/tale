// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({ formatDate: () => 'formatted-date' }),
}));

const { saveMock, testMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  testMock: vi.fn(),
}));

vi.mock('@/app/hooks/use-action-query', () => ({
  // The list query is enabled; the form-sheet detail query is disabled in
  // create mode (`enabled: false`), so it returns no row to hydrate from.
  useActionQuery: (
    _key: unknown,
    _fn: unknown,
    _args: unknown,
    opts?: { enabled?: boolean },
  ) => ({
    data:
      opts?.enabled === false
        ? undefined
        : [
            {
              slug: 'coolai',
              displayName: 'Cool AI',
              endpoint: 'https://broker.example.com/api/tokens',
              targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
            },
          ],
    isLoading: false,
  }),
}));

vi.mock('@/app/hooks/use-convex-action', async () => {
  const { getFunctionName } = await import('convex/server');
  return {
    // Route by the Convex function name so the save and test-broker actions
    // get distinct mocks (`api.*` refs are proxies — no reference equality).
    useConvexAction: (ref: Parameters<typeof getFunctionName>[0]) => ({
      mutateAsync: getFunctionName(ref).includes('testTokenSource')
        ? testMock
        : saveMock,
      isPending: false,
    }),
  };
});

vi.mock('@/app/hooks/use-list-page', () => ({
  useListPage: () => ({ tableProps: {} }),
}));

// Stub the DataTable to a no-op — the create panel is now opened via the
// hoisted `createOpen` prop (the New button lives on SettingsSection.action);
// the table primitive carries its own accessibility suite.
vi.mock('@/app/components/ui/data-table/data-table', () => ({
  DataTable: () => <div />,
}));

import { TokenSourcesManager } from './token-sources-manager';

describe('TokenSourcesManager', () => {
  it('opens an accessible, fully-labelled create panel', async () => {
    const { baseElement } = render(
      <TokenSourcesManager
        organizationId="org-1"
        createOpen
        onCreateOpenChange={vi.fn()}
      />,
    );

    // The sheet opened and every Select trigger has an accessible name (the
    // `label` prop wires `aria-labelledby` on the Radix combobox).
    expect(
      await screen.findByRole('combobox', { name: /tokenSources\.method/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /tokenSources\.authMethod/i }),
    ).toBeInTheDocument();

    await checkAccessibility(baseElement);
  });

  it('groups the form into labelled sections (#2395)', async () => {
    render(
      <TokenSourcesManager
        organizationId="org-1"
        createOpen
        onCreateOpenChange={vi.fn()}
      />,
    );
    await screen.findByRole('combobox', { name: /tokenSources\.method/i });

    for (const section of [
      'sectionIdentity',
      'sectionConnection',
      'sectionMapping',
      'sectionBinding',
    ]) {
      expect(
        screen.getByRole('group', {
          name: new RegExp(`tokenSources\\.${section}`, 'i'),
        }),
      ).toBeInTheDocument();
    }
  });

  it('runs the test-broker probe and shows the mapping preview (#2395)', async () => {
    testMock.mockResolvedValueOnce({
      ok: true,
      httpStatus: 200,
      itemCount: 5,
      usableCount: 3,
      missingTokenField: 0,
      inactiveCount: 2,
      expiredCount: 0,
      nextExpiryMs: 1_700_000_000_000,
    });

    const { user } = render(
      <TokenSourcesManager
        organizationId="org-1"
        createOpen
        onCreateOpenChange={vi.fn()}
      />,
    );
    await user.type(
      await screen.findByRole('textbox', { name: /tokenSources\.endpoint/i }),
      'https://broker.example.com/api/tokens',
    );
    await user.click(
      screen.getByRole('button', { name: /tokenSources\.test$/i }),
    );

    // The probe gets the draft config (never a raw form dump) …
    expect(testMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        config: expect.objectContaining({
          endpoint: 'https://broker.example.com/api/tokens',
          responseMapping: expect.objectContaining({
            tokensPath: '$.tokens',
            tokenField: 'access_token',
          }),
        }),
      }),
    );

    // … and the summary plus the per-filter drop reasons render inline.
    expect(
      await screen.findByText(/tokenSources\.testSummary/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/tokenSources\.testInactive/i)).toBeInTheDocument();
    expect(
      screen.getByText(/tokenSources\.testNextExpiry/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/tokenSources\.testMissingTokenField/i),
    ).not.toBeInTheDocument();
  });

  it('surfaces a broker failure from the probe as an inline error (#2395)', async () => {
    testMock.mockResolvedValueOnce({
      ok: false,
      error: 'http_error',
      httpStatus: 401,
    });

    const { user } = render(
      <TokenSourcesManager
        organizationId="org-1"
        createOpen
        onCreateOpenChange={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: /tokenSources\.test$/i }),
    );

    expect(
      await screen.findByText(/tokenSources\.testErrorHttp/i),
    ).toBeInTheDocument();

    // Editing any field clears the stale result.
    await user.type(
      screen.getByRole('textbox', { name: /tokenSources\.endpoint/i }),
      'x',
    );
    expect(
      screen.queryByText(/tokenSources\.testErrorHttp/i),
    ).not.toBeInTheDocument();
  });

  it('maps server field errors inline and never leaks the raw ConvexError (#2350)', async () => {
    saveMock.mockRejectedValueOnce({
      data: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid token source configuration',
        fieldErrors: { slug: ['Required'], endpoint: ['Invalid URL'] },
      },
    });

    const { user } = render(
      <TokenSourcesManager
        organizationId="org-1"
        createOpen
        onCreateOpenChange={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole('button', { name: /tokenSources\.save$/i }),
    );

    // Per-field messages surface inline on the offending inputs…
    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Invalid URL')).toBeInTheDocument();

    // …the toast carries a clean localized description, never the raw JSON.
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'common.editor.fixHighlightedFields',
      }),
    );
    const rawLeaked = vi
      .mocked(toast)
      .mock.calls.some((c) =>
        JSON.stringify(c).includes('Invalid token source configuration'),
      );
    expect(rawLeaked).toBe(false);
  });
});
