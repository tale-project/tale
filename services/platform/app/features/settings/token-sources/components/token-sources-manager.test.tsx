// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));

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

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: saveMock, isPending: false }),
}));

vi.mock('@/app/hooks/use-list-page', () => ({
  useListPage: () => ({ tableProps: {} }),
}));

// Stub the DataTable down to its `actionMenu` slot so the create panel can be
// opened; the table primitive carries its own accessibility suite.
vi.mock('@/app/components/ui/data-table/data-table', () => ({
  DataTable: ({ actionMenu }: { actionMenu?: ReactNode }) => (
    <div>{actionMenu}</div>
  ),
}));

import { TokenSourcesManager } from './token-sources-manager';

describe('TokenSourcesManager', () => {
  it('opens an accessible, fully-labelled create panel', async () => {
    const { user, baseElement } = render(
      <TokenSourcesManager organizationId="org-1" />,
    );

    await user.click(
      screen.getByRole('button', { name: /tokenSources\.new/i }),
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

  it('maps server field errors inline and never leaks the raw ConvexError (#2350)', async () => {
    saveMock.mockRejectedValueOnce({
      data: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid token source configuration',
        fieldErrors: { slug: ['Required'], endpoint: ['Invalid URL'] },
      },
    });

    const { user } = render(<TokenSourcesManager organizationId="org-1" />);
    await user.click(
      screen.getByRole('button', { name: /tokenSources\.new/i }),
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
