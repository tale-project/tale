import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/test/utils/a11y';

import { CanvasProvider, useCanvas } from '../canvas-context';
import { CanvasPane } from '../canvas-pane';

const FAKE_ARTIFACT_ID = 'k123fakeartifactid000000000000' as Id<'artifacts'>;

const BASE_ARTIFACT: Doc<'artifacts'> = {
  _id: FAKE_ARTIFACT_ID,
  _creationTime: 0,
  organizationId: 'org_test',
  threadId: 'thread_test',
  type: 'code',
  title: 'test.js',
  language: 'javascript',
  content: 'const x = 1;',
  revision: 1,
  createdByMessageId: 'msg_test',
  lastEditedByMessageId: 'msg_test',
  createdAt: 0,
  updatedAt: 0,
};

// Mutable holder so individual tests can override the artifact returned
// from the Convex `getById` query (e.g. to simulate a live stream).
const artifactHolder: { current: Doc<'artifacts'> } = {
  current: BASE_ARTIFACT,
};

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return artifactHolder.current;
  },
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'canvas.title': 'Canvas',
        'canvas.close': 'Close canvas',
        'canvas.edit': 'Edit',
        'canvas.preview': 'Preview',
        'canvas.copy': 'Copy',
        'canvas.download': 'Download',
        'canvas.exportPdf': 'Export as PDF',
        'canvas.exportPdfFailed': 'Failed to export as PDF',
        'canvas.copied': 'Copied!',
        'canvas.resizeHandle': 'Resize canvas',
        'canvas.mermaidError': 'Failed to render diagram',
        'canvas.enterFullscreen': 'Fullscreen',
        'canvas.exitFullscreen': 'Exit fullscreen',
        'canvas.streamingWriting': 'AI is writing…',
        'canvas.streamingPatch': 'AI is editing…',
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
}));

function OpenCanvasButton() {
  const { openCanvas } = useCanvas();
  return (
    <button type="button" onClick={() => openCanvas(FAKE_ARTIFACT_ID)}>
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
  afterEach(() => {
    artifactHolder.current = BASE_ARTIFACT;
  });

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

  it('toggles fullscreen mode and hides the resize handle', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('separator')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));

    expect(
      screen.getByRole('button', { name: 'Exit fullscreen' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Exit fullscreen' }));

    expect(
      screen.getByRole('button', { name: 'Fullscreen' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('does not show the PDF export button for code artifacts', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByText('Open'));
    expect(
      screen.queryByRole('button', { name: 'Export as PDF' }),
    ).not.toBeInTheDocument();
  });

  it('shows the PDF export button for HTML artifacts', async () => {
    const user = userEvent.setup();
    artifactHolder.current = {
      ...BASE_ARTIFACT,
      type: 'html',
      title: 'index.html',
      content: '<p>hi</p>',
      language: undefined,
    };
    render(<TestHarness />);
    await user.click(screen.getByText('Open'));
    expect(
      screen.getByRole('button', { name: 'Export as PDF' }),
    ).toBeInTheDocument();
  });

  it('shows the PDF export button for markdown artifacts', async () => {
    const user = userEvent.setup();
    artifactHolder.current = {
      ...BASE_ARTIFACT,
      type: 'markdown',
      title: 'doc.md',
      content: '# hello',
      language: undefined,
    };
    render(<TestHarness />);
    await user.click(screen.getByText('Open'));
    expect(
      screen.getByRole('button', { name: 'Export as PDF' }),
    ).toBeInTheDocument();
  });

  it('disables the PDF export button while a stream is in flight', async () => {
    const user = userEvent.setup();
    artifactHolder.current = {
      ...BASE_ARTIFACT,
      type: 'html',
      title: 'index.html',
      content: '<p>hi</p>',
      language: undefined,
      streamingContent: '<p>partial',
      liveStreamMode: 'create',
    };
    render(<TestHarness />);
    await user.click(screen.getByText('Open'));
    expect(
      screen.getByRole('button', { name: 'Export as PDF' }),
    ).toBeDisabled();
  });

  it('shows the streaming source as plain text during a create stream', async () => {
    const user = userEvent.setup();
    artifactHolder.current = {
      ...BASE_ARTIFACT,
      content: '',
      streamingContent: 'const partial = ',
      liveStreamMode: 'create',
    };
    render(<TestHarness />);

    await user.click(screen.getByText('Open'));

    // The streaming badge appears so the source-view branch is active.
    expect(screen.getByText('AI is writing…')).toBeInTheDocument();
    // The streaming source view renders the partial content directly,
    // bypassing shiki to avoid the cancel-storm that makes a fast stream
    // appear to render in 2-second bursts. The plain code text lives in
    // the DOM as a real text node (not via dangerouslySetInnerHTML);
    // it sits inside an `IncrementalText` host span that is itself inside
    // the `<code>` element, so we walk up to confirm the structural
    // expectation.
    const node = screen.getByText('const partial =', { exact: false });
    expect(node).toBeInTheDocument();
    expect(node.closest('code')).not.toBeNull();
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
