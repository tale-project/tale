// @vitest-environment jsdom
/**
 * `AutomationView` hands bundle JSON to Puck's `<Render>`, which keys children
 * by `item.props.id` — an id only editor-inserted nodes carry. Hand-authored
 * view docs (every desk.json) omit it, so React logged the "unique key"
 * warning and reconciliation fell back to positional identity. Pins:
 *
 *  - id-less content renders without the React key warning (ids are stamped);
 *  - explicitly authored ids survive normalization (zone compounds and
 *    editor round-trips reference them).
 */
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// i18n → echo `<ns>.<key>` (the sibling suites' stand-in; not on the suspect path).
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

// Router — effect/navigation hooks used by blocks; no routing is exercised.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'org-1' }),
  Link: ({ children, ...rest }: { children?: ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

// Convex network seams — imported transitively by connected blocks; unused here.
vi.mock('@/app/hooks/use-convex-paginated-query', () => ({
  useConvexPaginatedQuery: () => ({
    results: [],
    status: 'Exhausted',
    isLoading: false,
    loadMore: vi.fn(),
  }),
}));
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined, isLoading: true, error: null }),
}));
vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('convex/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

import type { Data } from '@measured/puck';

import { AutomationRuntimeProvider } from '../runtime/automation-runtime';
import { AutomationView, withStableItemIds } from './automation-view';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AutomationView — stable ids for hand-authored view docs', () => {
  it('renders id-less content without the React key warning', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AutomationRuntimeProvider
        value={{
          organizationId: 'org-1',
          automationSlug: 'test',
          allowlist: [],
          config: {},
        }}
      >
        <AutomationView
          data={{
            root: { props: {} },
            zones: {},
            content: [
              { type: 'Text', props: { text: 'First block', variant: 'body' } },
              {
                type: 'Text',
                props: { text: 'Second block', variant: 'body' },
              },
            ],
          }}
        />
      </AutomationRuntimeProvider>,
    );

    expect(screen.getByText('First block')).toBeInTheDocument();
    expect(screen.getByText('Second block')).toBeInTheDocument();
    const keyWarnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes('unique "key" prop'),
    );
    expect(keyWarnings).toEqual([]);
  });

  it('stamps only id-less items and leaves authored ids and zones intact', () => {
    const data = {
      root: { props: {} },
      zones: {
        'card-1:body': [
          { type: 'Text', props: { text: 'zoned', variant: 'body' } },
        ],
      },
      content: [
        { type: 'Text', props: { id: 'authored', text: 'a', variant: 'body' } },
        { type: 'Text', props: { text: 'b', variant: 'body' } },
      ],
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture matches Data at runtime
    } as unknown as Data;

    const out = withStableItemIds(data);

    expect(out.content[0]?.props.id).toBe('authored');
    expect(out.content[1]?.props.id).toBe('content:Text-1');
    expect(out.zones?.['card-1:body']?.[0]?.props.id).toBe(
      'card-1:body:Text-0',
    );
    // Original doc untouched (bundle JSON is shared/cached upstream).
    expect(data.content[1]?.props.id).toBeUndefined();
  });
});
