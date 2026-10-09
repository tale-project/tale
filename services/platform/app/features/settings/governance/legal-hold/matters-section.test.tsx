import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import { MattersSection } from './matters-section';

const query = vi.hoisted(() => ({
  data: undefined as
    | {
        _id: string;
        name: string;
        status: 'open';
        linkedActiveHolds: number;
        createdAt: number;
      }[]
    | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({
  useLegalMatters: () => query,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('./upsert-matter-dialog', () => ({
  UpsertMatterDialog: () => null,
}));

vi.mock('./close-matter-dialog', () => ({
  CloseMatterDialog: () => null,
}));

describe('MattersSection read states', () => {
  beforeEach(() => {
    query.data = undefined;
    query.isLoading = false;
    query.isError = false;
    query.error = null;
    query.refetch.mockReset();
  });

  it('shows a failed read instead of an empty register and retries the query', async () => {
    query.isError = true;
    query.error = new Error('HTTP 503');
    const { user, rerender } = render(
      <MattersSection organizationId="org-1" />,
    );

    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(query.refetch).toHaveBeenCalledTimes(1);

    query.isError = false;
    query.error = null;
    query.data = [];
    rerender(<MattersSection organizationId="org-1" />);

    expect(screen.getByText('No matters')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it('reserves the empty state for a successful empty response', () => {
    query.data = [];
    render(<MattersSection organizationId="org-1" />);

    expect(screen.getByText('No matters')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /something went wrong/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it('does not show an empty register while the initial read is loading', () => {
    query.isLoading = true;
    render(<MattersSection organizationId="org-1" />);

    expect(screen.queryByText('No matters')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it('reports a failed refresh even when the query retains cached matters', () => {
    query.data = [
      {
        _id: 'matter-1',
        name: 'Existing matter',
        status: 'open',
        linkedActiveHolds: 0,
        createdAt: 0,
      },
    ];
    query.isError = true;
    query.error = new Error('HTTP 503');
    render(<MattersSection organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();
  });

  describe('focus during read recovery', () => {
    beforeEach(() => {
      query.isError = true;
      query.error = new Error('HTTP 503');
    });

    it('moves keyboard retry focus to the named section before rereading', async () => {
      const { user } = render(<MattersSection organizationId="org-1" />);
      const section = screen.getByRole('region', { name: 'Matters' });
      let focusAtRead: Element | null = null;
      query.refetch.mockImplementation(() => {
        focusAtRead = document.activeElement;
      });
      screen.getByRole('button', { name: /try again/i }).focus();
      await user.keyboard('{Enter}');

      expect(query.refetch).toHaveBeenCalledTimes(1);
      expect(focusAtRead).toBe(section);
      expect(section).toHaveFocus();
    });

    it.each(['empty', 'rows', 'loading'] as const)(
      'keeps focus in the section when a background refresh replaces the error with %s',
      async (answer) => {
        const { rerender } = render(<MattersSection organizationId="org-1" />);
        screen.getByRole('button', { name: /try again/i }).focus();
        query.isError = false;
        query.error = null;
        query.isLoading = answer === 'loading';
        query.data =
          answer === 'rows'
            ? [
                {
                  _id: 'matter-1',
                  name: 'Existing matter',
                  status: 'open',
                  linkedActiveHolds: 0,
                  createdAt: 0,
                },
              ]
            : answer === 'empty'
              ? []
              : undefined;
        rerender(<MattersSection organizationId="org-1" />);

        await waitFor(() =>
          expect(screen.getByRole('region', { name: 'Matters' })).toHaveFocus(),
        );
        if (answer === 'empty')
          expect(screen.getByText('No matters')).toBeInTheDocument();
        if (answer === 'rows')
          expect(screen.getByText('Existing matter')).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /try again/i }),
        ).not.toBeInTheDocument();
      },
    );

    it('leaves focus the reader moved elsewhere before healing alone', async () => {
      const view = () => (
        <>
          <MattersSection organizationId="org-1" />
          <button type="button">Elsewhere</button>
        </>
      );
      const { rerender } = render(view());
      screen.getByRole('button', { name: /try again/i }).focus();
      const outside = screen.getByRole('button', { name: 'Elsewhere' });
      outside.focus();
      query.data = [];
      query.isError = false;
      query.error = null;
      rerender(view());
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });

      expect(outside).toHaveFocus();
      expect(screen.getByText('No matters')).toBeInTheDocument();
    });

    it('leaves deliberate foreign focus before the queued handoff frame alone', () => {
      const view = () => (
        <>
          <MattersSection organizationId="org-1" />
          <button type="button">Elsewhere</button>
        </>
      );
      const { rerender } = render(view());
      screen.getByRole('button', { name: /try again/i }).focus();
      const frames: FrameRequestCallback[] = [];
      const raf = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((callback) => {
          frames.push(callback);
          return frames.length;
        });
      try {
        query.data = [];
        query.isError = false;
        query.error = null;
        rerender(view());
        expect(frames).toHaveLength(1);
        const outside = screen.getByRole('button', { name: 'Elsewhere' });
        outside.focus();
        act(() => {
          for (const frame of frames) frame(0);
        });

        expect(outside).toHaveFocus();
      } finally {
        raf.mockRestore();
      }
    });
  });
});
