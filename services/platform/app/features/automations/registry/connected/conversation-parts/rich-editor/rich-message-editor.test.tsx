// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

// Milkdown mechanics mocked away (jsdom has no ProseMirror layout) — the
// same approach the old inbox message-editor test used, plus captured
// listener hooks so the markdownUpdated → onChange wiring is observable.
let capturedMarkdownUpdated: ((ctx: unknown, markdown: string) => void) | null =
  null;
const readonlyCalls: boolean[] = [];

vi.mock('@milkdown/crepe', () => {
  class MockCrepe {
    static Feature = { Placeholder: 'placeholder' };
    on(
      fn: (listener: {
        markdownUpdated: (cb: (ctx: unknown, markdown: string) => void) => void;
        focus: (cb: () => void) => void;
        blur: (cb: () => void) => void;
      }) => void,
    ) {
      fn({
        markdownUpdated: (cb) => {
          capturedMarkdownUpdated = cb;
        },
        focus: () => {},
        blur: () => {},
      });
      return this;
    }
    setReadonly(value: boolean) {
      readonlyCalls.push(value);
      return this;
    }
  }
  return { Crepe: MockCrepe };
});

vi.mock('@milkdown/react', () => ({
  MilkdownProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="milkdown-provider">{children}</div>
  ),
  Milkdown: () => <div data-testid="milkdown-editor" />,
  useEditor: (factory: (root: HTMLElement) => unknown) => {
    factory(document.createElement('div'));
    return { get: () => undefined, loading: false };
  },
  useInstance: () => [false],
}));

import { RichMessageEditor } from './rich-message-editor';

describe('RichMessageEditor', () => {
  beforeEach(() => {
    capturedMarkdownUpdated = null;
    readonlyCalls.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the editor surface with the actions and attachments slots', () => {
    render(
      <RichMessageEditor
        onChange={() => {}}
        attachments={<span>two files</span>}
        actions={<button type="button">Send it</button>}
      />,
    );
    expect(screen.getByTestId('milkdown-provider')).toBeInTheDocument();
    expect(screen.getByTestId('milkdown-editor')).toBeInTheDocument();
    expect(screen.getByText('two files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
  });

  it('reports document changes as markdown through onChange', () => {
    const onChange = vi.fn();
    render(<RichMessageEditor onChange={onChange} />);

    act(() => {
      capturedMarkdownUpdated?.(null, 'typed **markdown**');
    });

    expect(onChange).toHaveBeenCalledWith('typed **markdown**');
  });

  it('fires onSubmit on Cmd/Ctrl+Enter but not plain Enter', () => {
    const onSubmit = vi.fn();
    render(<RichMessageEditor onChange={() => {}} onSubmit={onSubmit} />);
    const surface = screen.getByTestId('milkdown-editor');

    fireEvent.keyDown(surface, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(surface, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(surface, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('puts the editor into readonly mode while disabled', () => {
    const { rerender } = render(
      <RichMessageEditor onChange={() => {}} disabled={false} />,
    );
    rerender(<RichMessageEditor onChange={() => {}} disabled />);
    expect(readonlyCalls.at(-1)).toBe(true);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <RichMessageEditor onChange={() => {}} placeholder="Write a reply" />,
      );
      await checkAccessibility(container);
    });
  });
});
