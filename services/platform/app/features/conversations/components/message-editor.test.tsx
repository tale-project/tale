// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, act } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

let renderCount = 0;
let capturedOnSend: (() => void) | null = null;
let capturedOnFileAttach: ((file: AttachedFile) => void) | null = null;
// The files the composer currently holds, as it hands them to the list.
let listedFiles: AttachedFile[] = [];
let listDisabled: boolean | undefined;
// What the persisted drafts start from — a typed body unless a test clears it.
let persistedSeed = 'some content';

// The HTML the mocked editor "displays" — the send path must deliver exactly
// this document (serialized via the editor's own getHTML action), not a
// re-render of the markdown state.
const MOCK_EDITOR_HTML =
  '<p>hello</p><p></p><p><a href="https://example.com">link</a></p>';
let liveMarkdown = 'current editor content';
let liveHtml = MOCK_EDITOR_HTML;

vi.mock('@milkdown/crepe', () => {
  class MockCrepe {
    static Feature = { Placeholder: 'placeholder' };
    on() {}
    get editor() {
      return {
        action: (action: (ctx: undefined) => unknown) => action(undefined),
        config: vi.fn(),
      };
    }
  }
  return { Crepe: MockCrepe };
});

vi.mock('@milkdown/kit/utils', () => ({
  getHTML: () => () => liveHtml,
  getMarkdown: () => () => liveMarkdown,
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
    const [value, setValue] = useState(initial || persistedSeed);
    const clear = useCallback(() => {
      setValue(initial);
      window.localStorage.removeItem(key);
    }, [key, initial]);
    return [value, setValue, clear] as const;
  },
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../hooks/actions', () => ({
  useImproveMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('./message-editor/editor-action-bar', () => ({
  EditorActionBar: ({
    onSend,
    onFileAttach,
  }: {
    onSend: () => void;
    onFileAttach: (file: AttachedFile) => void;
  }) => {
    capturedOnSend = onSend;
    capturedOnFileAttach = onFileAttach;
    return (
      <button data-testid="send-button" onClick={onSend}>
        Send
      </button>
    );
  },
}));

vi.mock('./message-editor/file-attachments-list', () => ({
  FileAttachmentsList: ({
    files,
    disabled,
  }: {
    files: AttachedFile[];
    disabled?: boolean;
  }) => {
    listedFiles = files;
    listDisabled = disabled;
    return null;
  },
}));

vi.mock('./message-editor/improve-mode', () => ({
  ImproveMode: () => null,
}));

vi.mock('./message-improvement-dialog', () => ({
  MessageImprovementDialog: () => null,
}));

import { toast } from '@tale/ui/use-toast';

import { MessageEditor } from './message-editor';
import { storedAttachedFile, type AttachedFile } from './message-editor/types';

describe('MessageEditor', () => {
  beforeEach(() => {
    renderCount = 0;
    capturedOnSend = null;
    capturedOnFileAttach = null;
    listedFiles = [];
    persistedSeed = 'some content';
    liveMarkdown = 'current editor content';
    liveHtml = MOCK_EDITOR_HTML;
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
      'current editor content',
    );
  });

  // Nothing typed, a file attached: the editor offers Send, and the send it
  // hands over is the file with an empty body and no draft to restore.
  it('hands a file with no text over as an attachment-only send', async () => {
    persistedSeed = '';
    liveMarkdown = '';
    liveHtml = '<p></p>';
    vi.mocked(toast).mockClear();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const attached: AttachedFile = {
      id: 'f1',
      file: new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
      type: 'document',
    };

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);

    await act(async () => {
      capturedOnFileAttach?.(attached);
    });
    await act(async () => {
      capturedOnSend?.();
    });

    expect(onSave).toHaveBeenCalledWith('', [attached], undefined);
    expect(toast).not.toHaveBeenCalled();
  });

  it('sends nothing with neither text nor a file', async () => {
    persistedSeed = '';
    liveMarkdown = '';
    liveHtml = '<p></p>';
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);

    await act(async () => {
      capturedOnSend?.();
    });

    expect(onSave).not.toHaveBeenCalled();
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

  it('keeps the body and the files out of reach while their send is in flight', async () => {
    let failSend = (_error: Error) => {};
    const onSave = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSend = reject;
        }),
    );

    render(<MessageEditor onSave={onSave} organizationId="org_test" />);
    const body = screen.getByTestId('milkdown-editor').parentElement;
    expect(body).not.toHaveAttribute('inert');
    expect(listDisabled).toBe(false);

    await act(async () => {
      capturedOnSend?.();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(body).toHaveAttribute('inert');
    // The files went with the send: removing one now would be neither
    // honored nor kept.
    expect(listDisabled).toBe(true);

    await act(async () => {
      failSend(new Error('Send failed'));
    });

    expect(body).not.toHaveAttribute('inert');
    expect(listDisabled).toBe(false);
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

  it('notifies onPendingMessageConsumed before remount on successful send', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onPendingMessageConsumed = vi.fn();

    render(
      <MessageEditor
        onSave={onSave}
        organizationId="org_test"
        pendingMessage={{ id: 'msg_1', content: 'restored draft' }}
        onPendingMessageConsumed={onPendingMessageConsumed}
      />,
    );

    const countBefore = renderCount;

    await act(async () => {
      capturedOnSend?.();
    });

    expect(onPendingMessageConsumed).toHaveBeenCalledTimes(1);
    expect(renderCount).toBeGreaterThan(countBefore);
  });

  it('does not consume pendingMessage when send fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Send failed'));
    const onPendingMessageConsumed = vi.fn();

    render(
      <MessageEditor
        onSave={onSave}
        organizationId="org_test"
        pendingMessage={{ id: 'msg_1', content: 'restored draft' }}
        onPendingMessageConsumed={onPendingMessageConsumed}
      />,
    );

    await act(async () => {
      capturedOnSend?.();
    });

    expect(onPendingMessageConsumed).not.toHaveBeenCalled();
  });

  // Undoing a send hands its draft back — the text and the files. The files
  // used to be dropped, so undoing an attachment-only reply restored nothing.
  describe('a draft handed back by an undo', () => {
    const invoice = storedAttachedFile({
      storageId: 's3:org_test/invoice',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 8,
    });

    it('comes back with its text and its files, and re-sends both', async () => {
      liveMarkdown = 'The invoice is attached.';
      liveHtml = '<p>The invoice is attached.</p>';
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <MessageEditor
          onSave={onSave}
          organizationId="org_test"
          pendingMessage={{
            id: 'msg_1',
            content: 'The invoice is attached.',
            attachments: [invoice],
          }}
        />,
      );

      expect(listedFiles).toEqual([invoice]);

      await act(async () => {
        capturedOnSend?.();
      });

      expect(onSave).toHaveBeenCalledWith(
        '<p>The invoice is attached.</p>',
        [invoice],
        'The invoice is attached.',
      );
    });

    it('comes back with its files alone when the send carried no text', async () => {
      persistedSeed = '';
      liveMarkdown = '';
      liveHtml = '<p></p>';
      const onSave = vi.fn().mockResolvedValue(undefined);

      render(
        <MessageEditor
          onSave={onSave}
          organizationId="org_test"
          pendingMessage={{ id: 'msg_1', content: '', attachments: [invoice] }}
        />,
      );

      expect(listedFiles).toEqual([invoice]);

      await act(async () => {
        capturedOnSend?.();
      });

      expect(onSave).toHaveBeenCalledWith('', [invoice], undefined);
    });

    it('keeps a file attached before the undo, and never lists one twice', async () => {
      const picked: AttachedFile = {
        id: 'f_picked',
        file: new File(['x'], 'notes.txt', { type: 'text/plain' }),
        type: 'document',
      };
      const { rerender } = render(<MessageEditor organizationId="org_test" />);
      await act(async () => {
        capturedOnFileAttach?.(picked);
      });

      const draft = { id: 'msg_1', content: 'Back', attachments: [invoice] };
      rerender(
        <MessageEditor organizationId="org_test" pendingMessage={draft} />,
      );
      rerender(
        <MessageEditor
          organizationId="org_test"
          pendingMessage={{ ...draft, attachments: [invoice] }}
        />,
      );

      expect(listedFiles).toEqual([invoice, picked]);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<MessageEditor organizationId="org_test" />);
      await checkAccessibility(container);
    });
  });
});
