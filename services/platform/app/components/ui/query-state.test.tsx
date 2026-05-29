import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { QueryState } from './query-state';

interface Data {
  items: string[];
}

function fakeResult(over: Partial<UseQueryResult<Data>>): UseQueryResult<Data> {
  return {
    isError: false,
    error: null,
    data: undefined,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<Data>;
}

describe('QueryState', () => {
  it('renders the skeleton in an aria-busy status region while pending', () => {
    render(
      <QueryState query={fakeResult({})} pending={<div>loading…</div>}>
        {(data) => <div>{data.items.join(',')}</div>}
      </QueryState>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('loading…');
  });

  it('renders children with the loaded data', () => {
    render(
      <QueryState
        query={fakeResult({ data: { items: ['a', 'b'] } })}
        pending={<div>loading…</div>}
      >
        {(data) => <div>{data.items.join(',')}</div>}
      </QueryState>,
    );
    expect(screen.getByText('a,b')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the empty state when isEmpty is true', () => {
    render(
      <QueryState
        query={fakeResult({ data: { items: [] } })}
        pending={<div>loading…</div>}
        empty={<div>no items</div>}
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => <div>{data.items.join(',')}</div>}
      </QueryState>,
    );
    expect(screen.getByText('no items')).toBeInTheDocument();
  });

  it('renders a retry affordance on error and calls refetch', async () => {
    const refetch = vi.fn();
    const { user } = render(
      <QueryState
        query={fakeResult({
          isError: true,
          error: new Error('nope'),
          refetch,
        })}
        pending={<div>loading…</div>}
      >
        {(data) => <div>{data.items.join(',')}</div>}
      </QueryState>,
    );
    const button = screen.getByRole('button');
    await user.click(button);
    expect(refetch).toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes axe audit while pending', async () => {
      const { container } = render(
        <QueryState query={fakeResult({})} pending={<div>loading…</div>}>
          {(data) => <div>{data.items.join(',')}</div>}
        </QueryState>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when loaded', async () => {
      const { container } = render(
        <QueryState
          query={fakeResult({ data: { items: ['a'] } })}
          pending={<div>loading…</div>}
        >
          {(data) => <div>{data.items.join(',')}</div>}
        </QueryState>,
      );
      await checkAccessibility(container);
    });
  });
});
