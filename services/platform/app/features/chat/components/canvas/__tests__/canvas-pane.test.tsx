import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

import { CanvasProvider, useCanvas } from '../canvas-context';
import { CanvasPane } from '../canvas-pane';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'canvas.title': 'Canvas',
        'canvas.openInCanvas': 'Open in Canvas',
        'canvas.close': 'Close canvas',
        'canvas.edit': 'Edit',
        'canvas.preview': 'Preview',
        'canvas.copy': 'Copy',
        'canvas.download': 'Download',
        'canvas.copied': 'Copied!',
        'canvas.resizeHandle': 'Resize canvas',
        'canvas.mermaidError': 'Failed to render diagram',
        'canvas.codeEditor': 'Code editor',
        'canvas.apply': 'Apply changes',
        'canvas.applyTooltip': 'Send edited code back to chat',
        'canvas.viewCode': 'View source code',
        'canvas.viewRender': 'View rendered output',
      };
      return translations[key] ?? key;
    },
  }),
}));

vi.mock('@/app/components/theme/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('@/lib/utils/shiki', () => ({
  highlightCode: vi.fn(() => Promise.resolve('')),
  extractShikiCodeContent: vi.fn((html: string) => {
    const match = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
    return match ? match[1] : html;
  }),
}));

function OpenCanvasButton() {
  const { openCanvas } = useCanvas();
  return (
    <button
      type="button"
      onClick={() =>
        openCanvas('const x = 1;', 'code', 'test.js', 'javascript')
      }
    >
      Open
    </button>
  );
}

function TestHarness({ children }: { children?: ReactNode }) {
  return (
    <CanvasProvider>
      <OpenCanvasButton />
      <CanvasPane />
      {children}
    </CanvasProvider>
  );
}

describe('CanvasPane', () => {
  it('does not render when canvas is closed', () => {
    render(<TestHarness />);
    expect(screen.queryByText('test.js')).not.toBeInTheDocument();
  });

  it('renders when canvas is opened', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));

    expect(screen.getByText('test.js')).toBeInTheDocument();
  });

  it('shows close button that hides the pane', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));
    expect(screen.getByText('test.js')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close canvas' }));
    expect(screen.queryByText('test.js')).not.toBeInTheDocument();
  });

  it('shows copy button in the toolbar', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('shows download button in the toolbar', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));

    expect(
      screen.getByRole('button', { name: 'Download' }),
    ).toBeInTheDocument();
  });

  it('shows edit toggle for code content type', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('has an accessible resize handle', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));

    const separator = screen.getByRole('separator');
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-label', 'Resize canvas');
  });

  describe('apply button', () => {
    it('is not visible when content is not dirty', async () => {
      const user = userEvent.setup();
      render(<TestHarness />);

      await user.click(screen.getByText('Open'));

      expect(
        screen.queryByRole('button', { name: 'Apply changes' }),
      ).not.toBeInTheDocument();
    });

    it('is visible when content has been edited', async () => {
      const user = userEvent.setup();
      render(<TestHarness />);

      await user.click(screen.getByText('Open'));
      await user.click(screen.getByRole('button', { name: 'Edit' }));

      const textarea = screen.getByRole('textbox', { name: 'Code editor' });
      await user.type(textarea, ' // changed');

      expect(
        screen.getByRole('button', { name: 'Apply changes' }),
      ).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit when canvas is open', async () => {
      const user = userEvent.setup();
      const { container } = render(<TestHarness />);

      await user.click(screen.getByText('Open'));

      await checkAccessibility(container);
    });

    it('passes axe audit when canvas is closed', async () => {
      const { container } = render(<TestHarness />);
      await checkAccessibility(container);
    });
  });
});
