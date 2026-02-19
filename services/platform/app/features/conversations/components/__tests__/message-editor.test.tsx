// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils/render';

let renderCount = 0;
let capturedOnSend: (() => void) | null = null;

vi.mock('@milkdown/crepe', () => {
  class MockCrepe {
    static Feature = { Placeholder: 'placeholder' };
    on() {}
  }
  return { Crepe: MockCrepe };
});

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
  useEditor: vi.fn(),
  useInstance: () => [false],
}));

vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}));

vi.mock('react-dom/server', () => ({
  renderToStaticMarkup: () => '<p>content</p>',
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <>{children}</>,
}));

vi.mock('@/app/hooks/use-persisted-state', () => ({
  usePersistedState: (_key: string, initial: string) => {
    return useState(initial || 'some content');
  },
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../hooks/actions', () => ({
  useImproveMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../message-editor/editor-action-bar', () => ({
  EditorActionBar: ({ onSend }: { onSend: () => void }) => {
    capturedOnSend = onSend;
    return (
      <button data-testid="send-button" onClick={onSend}>
        Send
      </button>
    );
  },
}));

vi.mock('../message-editor/file-attachments-list', () => ({
  FileAttachmentsList: () => null,
}));

vi.mock('../message-editor/improve-mode', () => ({
  ImproveMode: () => null,
}));

vi.mock('../message-improvement-dialog', () => ({
  MessageImprovementDialog: () => null,
}));

import { MessageEditor } from '../message-editor';

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
    render(<MessageEditor />);
    expect(screen.getByTestId('milkdown-provider')).toBeInTheDocument();
  });

  it('remounts MilkdownProvider after successful send', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<MessageEditor onSave={onSave} />);

    const initialCount = renderCount;

    await act(async () => {
      capturedOnSend?.();
    });

    expect(onSave).toHaveBeenCalled();
    expect(renderCount).toBeGreaterThan(initialCount);
  });

  it('clears localStorage after successful send', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const storageKey = 'new-conversation';
    window.localStorage.setItem(storageKey, JSON.stringify('draft content'));

    render(<MessageEditor onSave={onSave} />);

    await act(async () => {
      capturedOnSend?.();
    });

    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('does not remount MilkdownProvider when send fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Send failed'));

    render(<MessageEditor onSave={onSave} />);

    const initialCount = renderCount;

    await act(async () => {
      capturedOnSend?.();
    });

    expect(renderCount).toBe(initialCount);
  });
});
