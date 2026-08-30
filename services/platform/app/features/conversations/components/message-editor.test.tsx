// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, act } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

let renderCount = 0;
let capturedOnSend: (() => void) | null = null;

// The HTML the mocked editor "displays" — the send path must deliver exactly
// this document (serialized via the editor's own getHTML action), not a
// re-render of the markdown state.
const MOCK_EDITOR_HTML =
  '<p>hello</p><p></p><p><a href="https://example.com">link</a></p>';

vi.mock('@milkdown/crepe', () => {
  class MockCrepe {
    static Feature = { Placeholder: 'placeholder' };
    on() {}
    get editor() {
      return { action: () => MOCK_EDITOR_HTML };
    }
  }
  return { Crepe: MockCrepe };
});

vi.mock('@milkdown/kit/utils', () => ({
  getHTML: () => () => '',
}));

vi.mock('@milkdown/react', () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => {
    renderCount++;
    return (
      <div data-testid="milkdown-provider" data-render-count={renderCount}>
        {children}
      </div>
    );
  },
  Milkdown: () => <div data-testid="milkdown-editor" />,
  // Run the factory so the component's crepeRef is populated, mirroring the
  // real hook's behaviour enough for the send path to reach the editor.
  useEditor: (factory: (root: HTMLElement) => unknown) => {
    factory(document.createElement('div'));
  },
  useInstance: () => [false],
}));

vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}));

vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { userId: 'test-user-id' } }),
}));

vi.mock('@/app/hooks/use-persisted-state', () => ({
  usePersistedState: (key: string, initial: string) => {
    const [value, setValue] = useState(initial || 'some content');
    const clear = useCallback(() => {
      setValue(initial);
      window.localStorage.removeItem(key);
    }, [key, initial]);
    return [value, setValue, clear] as const;
  },
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../hooks/actions', () => ({
  useImproveMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('./message-editor/editor-action-bar', () => ({
  EditorActionBar: ({ onSend }: { onSend: () => void }) => {
    capturedOnSend = onSend;
    return (
      <button data-testid="send-button" onClick={onSend}>
        Send
      </button>
    );
  },
}));

vi.mock('./message-editor/file-attachments-list', () => ({
  FileAttachmentsList: () => null,
}));

vi.mock('./message-editor/improve-mode', () => ({
  ImproveMode: () => null,
}));

vi.mock('./message-improvement-dialog', () => ({
  MessageImprovementDialog: () => null,
}));

import { MessageEditor } from './message-editor';

describe('MessageEditor', () => {
  beforeEach(() => {
    renderCount = 0;
    capturedOnSend = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the editor', () => {
    render(<MessageEditor organizationId="org_test" />);
    expect(screen.getByTestId('milkdown-provider')).toBeInTheDocument();
  });

  it('remounts MilkdownProvider after successful send', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);

    const initialCount = renderCount;

    await act(async () => {
      capturedOnSend?.();
    });

    expect(onSave).toHaveBeenCalled();
    expect(renderCount).toBeGreaterThan(initialCount);
  });

  it('sends the editor-serialized document, with anchors decorated', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);

    await act(async () => {
      capturedOnSend?.();
    });

    // The sent HTML is the editor's own document — empty paragraphs stay
    // real elements (never literal "<br />" text) and links gain the
    // outbound target/rel policy. The third argument is the markdown draft
    // at send time, threaded through for undo-send draft restore.
    expect(onSave).toHaveBeenCalledWith(
      '<p>hello</p><p></p><p><a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a></p>',
      [],
      'some content',
    );
  });

  it('clears localStorage after successful send', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const storageKey = 'conversation-test-user-id-new';
    window.localStorage.setItem(storageKey, JSON.stringify('draft content'));

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);

    await act(async () => {
      capturedOnSend?.();
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('does not remount MilkdownProvider when send fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Send failed'));

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);

    const initialCount = renderCount;

    await act(async () => {
      capturedOnSend?.();
    });

    expect(renderCount).toBe(initialCount);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<MessageEditor organizationId="org_test" />);
      await checkAccessibility(container);
    });
  });
});
