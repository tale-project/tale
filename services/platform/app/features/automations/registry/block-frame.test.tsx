// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { BindingStates, BlockFrame } from './block-frame';

// i18n → echo `automations.<key>`, interpolating params, so assertions read clearly
// (the same convention as the sibling registry tests).
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

describe('BlockFrame', () => {
  it('renders literal title/description verbatim', () => {
    render(
      <BlockFrame title="Issues" description="Open work">
        body
      </BlockFrame>,
    );
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('Open work')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders the right-aligned actions slot', () => {
    render(
      <BlockFrame title="T" actions={<button type="button">Refresh</button>}>
        body
      </BlockFrame>,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

describe('BindingStates', () => {
  it('renders children when no framing state applies', () => {
    render(<BindingStates>loaded</BindingStates>);
    expect(screen.getByText('loaded')).toBeInTheDocument();
  });

  it('blocked wins and shows the offending path', () => {
    render(
      <BindingStates
        blocked
        path="secret/x:peek"
        needsConfig
        awaitingState
        loading
      >
        loaded
      </BindingStates>,
    );
    expect(screen.getByText('automations.binding.blocked')).toBeInTheDocument();
    expect(screen.queryByText('loaded')).not.toBeInTheDocument();
    expect(
      screen.queryByText('automations.list.needsConfig'),
    ).not.toBeInTheDocument();
  });

  it('needsConfig precedes awaitingState and loading', () => {
    render(
      <BindingStates needsConfig awaitingState loading>
        loaded
      </BindingStates>,
    );
    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
  });

  it('needsProject precedes awaitingState and loading', () => {
    render(
      <BindingStates needsProject awaitingState loading>
        loaded
      </BindingStates>,
    );
    expect(
      screen.getByText('automations.list.needsProject'),
    ).toBeInTheDocument();
  });

  it('needsConfig precedes needsProject', () => {
    render(
      <BindingStates needsConfig needsProject>
        loaded
      </BindingStates>,
    );
    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('automations.list.needsProject'),
    ).not.toBeInTheDocument();
  });

  it('awaitingState shows the neutral selection placeholder', () => {
    render(<BindingStates awaitingState>loaded</BindingStates>);
    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
    expect(screen.queryByText('loaded')).not.toBeInTheDocument();
  });

  it('loading renders the default skeleton, or a custom one when given', () => {
    const { container, rerender } = render(
      <BindingStates loading>loaded</BindingStates>,
    );
    expect(screen.queryByText('loaded')).not.toBeInTheDocument();
    // The shared SkeletonText mask renders pulse lines.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();

    rerender(
      <BindingStates loading skeleton={<div>custom-skeleton</div>}>
        loaded
      </BindingStates>,
    );
    expect(screen.getByText('custom-skeleton')).toBeInTheDocument();
  });
});
