import { Folder, Telescope } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ChatPanel } from './chat-panel';
import { ChatPanelProvider } from './chat-panel-context';
import type { ChatPaneDescriptor } from './types';
import { useAutoOpen, useRegisterPane } from './use-register-pane';

// The shell + hooks read `useMatch` (thread id) and `useT`/`useIsMobile`. Stub
// them to stable values so the tests drive the registry directly.
vi.mock('@tanstack/react-router', () => ({
  useMatch: () => ({ params: { threadId: 't1' } }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? _key,
  }),
}));

let mockIsMobile = false;
vi.mock('@/app/hooks/use-is-mobile', () => ({
  useIsMobile: () => mockIsMobile,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsMobile = false;
});

/** A test pane: registers a descriptor and auto-opens on its content edge. */
function TestPane({
  id,
  label,
  hasContent,
  body,
}: {
  id: ChatPaneDescriptor['id'];
  label: string;
  hasContent: boolean;
  body: ReactNode;
}) {
  useAutoOpen(id, hasContent);
  // Memoize like the real panes do — an unmemoized fresh descriptor each render
  // re-runs the register effect and loops with the provider's state update.
  const descriptor = useMemo<ChatPaneDescriptor | null>(
    () =>
      hasContent
        ? {
            id,
            icon: id === 'plan' ? Telescope : Folder,
            label,
            ariaLabel: `Open ${label}`,
            hasContent: true,
            body,
          }
        : null,
    [id, label, hasContent, body],
  );
  useRegisterPane(descriptor);
  return null;
}

function renderShell(panes: ReactNode) {
  return render(
    <ChatPanelProvider>
      {panes}
      <ChatPanel />
    </ChatPanelProvider>,
  );
}

describe('ChatPanel', () => {
  it('renders nothing when no pane has content', () => {
    renderShell(
      <TestPane id="plan" label="Plan" hasContent={false} body={<div />} />,
    );
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'Chat panel' }),
    ).not.toBeInTheDocument();
  });

  it('auto-opens maximized on the active tab when content first appears', () => {
    renderShell(
      <TestPane
        id="plan"
        label="Plan"
        hasContent
        body={<div>plan body</div>}
      />,
    );
    // Auto-open fires on the false→true edge → maximized, this tab active.
    expect(screen.getByRole('complementary', { name: 'Chat panel' }));
    expect(screen.getByRole('tab', { name: 'Open Plan' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('plan body')).toBeVisible();
  });

  it('minimizing shows the shared strip with one button per content pane, and is never a dead-end', async () => {
    const { user } = renderShell(
      <>
        <TestPane
          id="plan"
          label="Plan"
          hasContent
          body={<div>plan body</div>}
        />
        <TestPane
          id="canvas"
          label="Canvas"
          hasContent
          body={<div>canvas body</div>}
        />
      </>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Minimize chat panel' }),
    );

    const strip = screen.getByRole('toolbar', { name: 'Chat panel' });
    // One affordance per content pane — not a single dead-end close.
    expect(
      screen.getByRole('button', { name: 'Open Plan' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Canvas' }),
    ).toBeInTheDocument();
    expect(strip).toBeInTheDocument();
    // No tabpanel while minimized.
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });

  it('clicking a strip button re-opens that pane maximized', async () => {
    const { user } = renderShell(
      <>
        <TestPane
          id="plan"
          label="Plan"
          hasContent
          body={<div>plan body</div>}
        />
        <TestPane
          id="canvas"
          label="Canvas"
          hasContent
          body={<div>canvas body</div>}
        />
      </>,
    );

    await user.click(
      screen.getByRole('button', { name: 'Minimize chat panel' }),
    );
    await user.click(screen.getByRole('button', { name: 'Open Canvas' }));

    expect(screen.getByRole('tab', { name: 'Open Canvas' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('canvas body')).toBeVisible();
  });

  it('switches the visible body when another tab is selected', async () => {
    const { user } = renderShell(
      <>
        <TestPane
          id="plan"
          label="Plan"
          hasContent
          body={<div>plan body</div>}
        />
        <TestPane
          id="canvas"
          label="Canvas"
          hasContent
          body={<div>canvas body</div>}
        />
      </>,
    );

    // Canvas registers last, so its false→true edge wins the auto-open.
    await user.click(screen.getByRole('tab', { name: 'Open Plan' }));

    expect(screen.getByText('plan body')).toBeVisible();
    expect(screen.getByText('canvas body')).not.toBeVisible();
  });

  it('keeps inactive bodies mounted (RFB-survival guarantee)', async () => {
    const { user } = renderShell(
      <>
        <TestPane
          id="plan"
          label="Plan"
          hasContent
          body={<div>plan body</div>}
        />
        <TestPane
          id="browser"
          label="Browser"
          hasContent
          body={<div>browser body</div>}
        />
      </>,
    );

    await user.click(screen.getByRole('tab', { name: 'Open Plan' }));

    // The Browser body is hidden but STILL in the DOM — the shell toggles
    // visibility, never unmounts, so a live WebSocket would survive.
    const browserBody = screen.getByText('browser body');
    expect(browserBody).toBeInTheDocument();
    expect(browserBody).not.toBeVisible();
  });

  describe('accessibility', () => {
    it('passes axe audit when maximized with tabs', async () => {
      const { container } = renderShell(
        <>
          <TestPane
            id="plan"
            label="Plan"
            hasContent
            body={<div>plan body</div>}
          />
          <TestPane
            id="canvas"
            label="Canvas"
            hasContent
            body={<div>canvas body</div>}
          />
        </>,
      );
      await checkAccessibility(container);
    });
  });
});
