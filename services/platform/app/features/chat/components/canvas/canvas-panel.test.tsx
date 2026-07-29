// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { CanvasSources } from '../../types';
import { CanvasPanel } from './canvas-panel';

function sources(overrides: Partial<CanvasSources> = {}): CanvasSources {
  return {
    kind: 'direct',
    hasSandboxSession: false,
    activity: [],
    files: [],
    artifacts: [],
    ...overrides,
  };
}

const SANDBOX_WITH_EVERYTHING = sources({
  kind: 'sandbox',
  hasSandboxSession: true,
  computerStreamUrl: 'https://sandbox.example/stream',
  activity: [{ id: 'a1', label: 'Ran a command', at: 1 }],
  files: [{ path: 'output/report.md', bytes: 12 }],
  artifacts: [
    { id: 'art-1', title: 'Report', url: 'https://sandbox.example/report' },
  ],
});

function tabNames() {
  return screen.getAllByRole('tab').map((tab) => tab.textContent?.trim() ?? '');
}

describe('CanvasPanel tab visibility', () => {
  it('renders nothing for a thread with no Canvas mode', () => {
    const { container } = render(<CanvasPanel sources={sources()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before a thread is open', () => {
    const { container } = render(<CanvasPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every mode for a sandbox thread that produced artifacts', () => {
    render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    expect(tabNames()).toEqual([
      'Computer view',
      'Live view',
      'File view',
      'Browser view',
    ]);
  });

  it('omits the sandbox modes on a direct thread, keeping only Browser view', () => {
    render(
      <CanvasPanel
        sources={sources({
          artifacts: [{ id: 'art-1', title: 'Report', url: 'about:blank' }],
        })}
      />,
    );

    expect(tabNames()).toEqual(['Browser view']);
  });

  it('omits Browser view when the thread has no artifact', () => {
    render(
      <CanvasPanel
        sources={sources({ kind: 'sandbox', hasSandboxSession: true })}
      />,
    );

    expect(tabNames()).not.toContain('Browser view');
  });

  it('states why a shown sandbox mode is empty instead of rendering a shell', () => {
    render(
      <CanvasPanel
        sources={sources({ kind: 'sandbox', hasSandboxSession: true })}
      />,
    );

    const panel = screen.getByRole('tabpanel');
    expect(
      within(panel).getByText(/isn't streaming right now/i),
    ).toBeInTheDocument();
  });

  it('explains a sandbox that never started with one reason for every mode', async () => {
    const { user } = render(
      <CanvasPanel
        sources={sources({ kind: 'sandbox', hasSandboxSession: false })}
      />,
    );

    for (const name of ['Computer view', 'Live view', 'File view']) {
      await user.click(screen.getByRole('tab', { name }));
      expect(
        within(screen.getByRole('tabpanel')).getByText(
          /hasn't started its sandbox yet/i,
        ),
      ).toBeInTheDocument();
    }
  });
});

describe('CanvasPanel content', () => {
  it('names the panel Canvas and its tab strip Canvas modes', () => {
    render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    expect(
      screen.getByRole('complementary', { name: 'Canvas' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tablist', { name: 'Canvas modes' }),
    ).toBeInTheDocument();
  });

  it('opens on the first mode with content', () => {
    render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(
      'Computer view',
    );
  });

  it('falls back to the first shown mode when none has content', () => {
    render(
      <CanvasPanel
        sources={sources({ kind: 'sandbox', hasSandboxSession: true })}
      />,
    );

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(
      'Computer view',
    );
  });

  it('shows the workspace files behind the File view tab', async () => {
    const { user } = render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    await user.click(screen.getByRole('tab', { name: 'File view' }));
    expect(screen.getByText('output/report.md')).toBeInTheDocument();
  });

  it('shows the turn activity behind the Live view tab', async () => {
    const { user } = render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    await user.click(screen.getByRole('tab', { name: 'Live view' }));
    expect(screen.getByText('Ran a command')).toBeInTheDocument();
  });
});

describe('CanvasPanel accessibility', () => {
  it('moves between tabs with the arrow keys', async () => {
    const { user } = render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    const first = screen.getByRole('tab', { name: 'Computer view' });
    first.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Live view' })).toHaveFocus();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(
      'Live view',
    );
  });

  it('keeps exactly one tab in the tab order', async () => {
    const { user } = render(<CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />);

    // Roving focus: once focus is in the strip, the selected tab is the only
    // one Tab reaches — the arrow keys move between the rest.
    await user.click(screen.getByRole('tab', { name: 'Live view' }));

    await waitFor(() => {
      const focusable = screen
        .getAllByRole('tab')
        .filter((tab) => tab.getAttribute('tabindex') !== '-1');
      expect(focusable).toHaveLength(1);
      expect(focusable[0]).toHaveTextContent('Live view');
    });
  });

  it('passes an axe audit with every mode shown', async () => {
    const { container } = render(
      <CanvasPanel sources={SANDBOX_WITH_EVERYTHING} />,
    );
    // The Computer view is a stream frame; jsdom cannot host a real one, so
    // the audit stays on this document instead of trying to reach into it.
    await waitFor(() => checkAccessibility(container, { iframes: false }));
  });

  it('passes an axe audit with a mode that has nothing to show', async () => {
    const { container } = render(
      <CanvasPanel
        sources={sources({ kind: 'sandbox', hasSandboxSession: true })}
      />,
    );
    await waitFor(() => checkAccessibility(container));
  });
});
