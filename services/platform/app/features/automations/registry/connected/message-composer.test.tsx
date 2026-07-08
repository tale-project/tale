// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useViewState, ViewStateProvider } from '../../runtime/view-state';
import type { RichMessageEditorProps } from './conversation-parts/rich-editor/rich-message-editor';
import {
  MessageComposer,
  type MessageComposerProps,
  readImprovedMessage,
} from './message-composer';

// i18n → echo `ns.key` so assertions read clearly.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// The Milkdown editor is heavy and browser-only — stand in a textarea that
// honors the same contract: uncontrolled `defaultValue` (the composer
// remounts it via `key` on programmatic changes), markdown out through
// `onChange`, Cmd/Ctrl+Enter → `onSubmit`, and the `actions` slot rendered.
vi.mock('./conversation-parts/rich-editor/rich-message-editor', () => ({
  RichMessageEditor: ({
    defaultValue,
    onChange,
    placeholder,
    ariaLabel,
    disabled,
    onSubmit,
    attachments,
    actions,
  }: RichMessageEditorProps) => (
    <div>
      <textarea
        aria-label={ariaLabel ?? placeholder}
        defaultValue={defaultValue}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit?.();
          }
        }}
      />
      {attachments}
      {actions}
    </div>
  ),
}));

// One dispatch spy per bound path so submit and improve are distinguishable.
type DispatchMock = ReturnType<
  typeof vi.fn<(...args: unknown[]) => Promise<unknown>>
>;
const dispatches = new Map<string, DispatchMock>();
function dispatchFor(path: string): DispatchMock {
  let d = dispatches.get(path);
  if (!d) {
    d = vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(null);
    dispatches.set(path, d);
  }
  return d;
}
vi.mock('../../hooks/use-bound-action', () => ({
  useBoundAction: (path: string) => ({
    dispatch: (...args: unknown[]) => dispatchFor(path)(...args),
    isPending: false,
  }),
}));

const applyEffect = vi.fn();
vi.mock('../../runtime/action-effects', () => ({
  useActionEffect: () => applyEffect,
}));

const toast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toast(...args),
}));

const SUBMIT = {
  path: 'conversations/mutations:replyToConversation',
  mode: 'mutation' as const,
  args: { content: '$input.body', conversationId: '$state.conversationId' },
  onSuccess: { kind: 'toast' as const, titleKey: 'inbox.sent' },
};

const IMPROVE = {
  path: 'conversations/actions:improveMessage',
  mode: 'action' as const,
  args: { originalMessage: '$input.body', organizationId: '$orgId' },
};

const BASE: MessageComposerProps = {
  submit: SUBMIT,
  requiresState: 'conversationId',
  placeholderKey: 'inbox.composerPlaceholder',
};

/** Drives the master selection like a ConversationList would. */
function SelectConversation({ id }: { id: string }) {
  const { setState } = useViewState();
  return (
    <button type="button" onClick={() => setState('conversationId', id)}>
      {`pick:${id}`}
    </button>
  );
}

function renderComposer(props: Partial<MessageComposerProps> = {}) {
  return render(
    <ViewStateProvider>
      <SelectConversation id="c1" />
      <SelectConversation id="c2" />
      <MessageComposer {...BASE} {...props} />
    </ViewStateProvider>,
  );
}

afterEach(() => {
  dispatches.clear();
  applyEffect.mockClear();
  toast.mockClear();
});

describe('MessageComposer — requiresState gate', () => {
  it('shows the authored placeholder until the state key is set', async () => {
    renderComposer();
    expect(screen.getByText('inbox.composerPlaceholder')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    // findBy — the rich editor mounts through React.lazy.
    expect(
      await screen.findByRole('textbox', { name: 'inbox.composerPlaceholder' }),
    ).toBeInTheDocument();
  });

  it('falls back to the shared awaiting-selection copy without a placeholderKey', () => {
    renderComposer({ placeholderKey: undefined });
    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
  });
});

describe('MessageComposer — submit', () => {
  it('dispatches ctx.input.body as sanitized HTML, clears the draft and fires both onSuccess effects', async () => {
    const submitDispatch = dispatchFor(SUBMIT.path);
    submitDispatch.mockResolvedValue({ id: 'msg1' });
    renderComposer({
      onSuccess: { kind: 'setState', key: 'conversationId', value: undefined },
    });

    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    const textbox = await screen.findByRole('textbox');
    await userEvent.type(textbox, 'Hello there');
    await userEvent.click(
      screen.getByRole('button', { name: 'automations.composer.send' }),
    );

    // The body is the markdown draft serialized to HTML — the contract the
    // old inbox editor established and replyToConversation still assumes.
    expect(submitDispatch).toHaveBeenCalledWith(SUBMIT.args, undefined, {
      input: { body: '<p>Hello there</p>' },
    });
    expect(applyEffect).toHaveBeenCalledWith(SUBMIT.onSuccess, { id: 'msg1' });
    expect(applyEffect).toHaveBeenCalledWith(
      { kind: 'setState', key: 'conversationId', value: undefined },
      { id: 'msg1' },
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('serializes markdown formatting into the HTML body', async () => {
    const submitDispatch = dispatchFor(SUBMIT.path);
    renderComposer();

    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    const textbox = await screen.findByRole('textbox');
    await userEvent.type(textbox, 'a **bold** reply');
    await userEvent.click(
      screen.getByRole('button', { name: 'automations.composer.send' }),
    );

    expect(submitDispatch).toHaveBeenCalledWith(SUBMIT.args, undefined, {
      input: { body: '<p>a <strong>bold</strong> reply</p>' },
    });
  });

  it('submits on Cmd/Ctrl+Enter and not on plain Enter', async () => {
    const submitDispatch = dispatchFor(SUBMIT.path);
    renderComposer();
    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    const textbox = await screen.findByRole('textbox');

    await userEvent.type(textbox, 'Line one{Enter}line two');
    expect(submitDispatch).not.toHaveBeenCalled();

    await userEvent.type(textbox, '{Meta>}{Enter}{/Meta}');
    expect(submitDispatch).toHaveBeenCalledTimes(1);
    expect(submitDispatch).toHaveBeenCalledWith(SUBMIT.args, undefined, {
      input: { body: '<p>Line one\nline two</p>' },
    });
  });

  it('keeps the send button disabled for an empty draft', async () => {
    renderComposer();
    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    expect(
      await screen.findByRole('button', { name: 'automations.composer.send' }),
    ).toBeDisabled();
  });

  it('renders a literal submitLabelKey verbatim', async () => {
    renderComposer({ submitLabelKey: 'Send it' });
    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    expect(
      await screen.findByRole('button', { name: 'Send it' }),
    ).toBeInTheDocument();
  });

  it('disables the composer when enabledWhen fails against the view state', async () => {
    renderComposer({ enabledWhen: "conversationId == 'c2'" });
    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    expect(await screen.findByRole('textbox')).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'pick:c2' }));
    expect(await screen.findByRole('textbox')).toBeEnabled();
  });
});

describe('MessageComposer — per-conversation drafts', () => {
  it('preserves each conversation draft across selection switches', async () => {
    renderComposer();
    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    await userEvent.type(await screen.findByRole('textbox'), 'draft for one');

    await userEvent.click(screen.getByRole('button', { name: 'pick:c2' }));
    expect(await screen.findByRole('textbox')).toHaveValue('');
    await userEvent.type(screen.getByRole('textbox'), 'draft for two');

    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    expect(await screen.findByRole('textbox')).toHaveValue('draft for one');
  });
});

describe('MessageComposer — improve', () => {
  it('replaces the draft with the suggestion and undoes back to the original', async () => {
    const improveDispatch = dispatchFor(IMPROVE.path);
    improveDispatch.mockResolvedValue({
      improvedMessage: 'A much better reply.',
    });
    renderComposer({ improve: IMPROVE });

    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    await userEvent.type(await screen.findByRole('textbox'), 'rough draft');
    await userEvent.click(
      screen.getByRole('button', { name: 'automations.composer.improve' }),
    );

    // Improve is fed the raw markdown draft — the old improveMessage contract.
    expect(improveDispatch).toHaveBeenCalledWith(IMPROVE.args, undefined, {
      input: { body: 'rough draft' },
    });
    expect(screen.getByRole('textbox')).toHaveValue('A much better reply.');

    await userEvent.click(
      screen.getByRole('button', { name: 'automations.composer.undo' }),
    );
    expect(screen.getByRole('textbox')).toHaveValue('rough draft');
    expect(
      screen.queryByRole('button', { name: 'automations.composer.undo' }),
    ).not.toBeInTheDocument();
  });

  it('toasts and keeps the draft when the improve action reports an error', async () => {
    const improveDispatch = dispatchFor(IMPROVE.path);
    improveDispatch.mockResolvedValue({
      improvedMessage: 'original',
      error: 'no provider key',
    });
    renderComposer({ improve: IMPROVE });

    await userEvent.click(screen.getByRole('button', { name: 'pick:c1' }));
    await userEvent.type(await screen.findByRole('textbox'), 'my text');
    await userEvent.click(
      screen.getByRole('button', { name: 'automations.composer.improve' }),
    );

    expect(toast).toHaveBeenCalledWith({
      title: 'automations.composer.improveFailed',
      variant: 'destructive',
    });
    expect(screen.getByRole('textbox')).toHaveValue('my text');
  });
});

describe('readImprovedMessage', () => {
  it('reads `improvedMessage` records and bare strings', () => {
    expect(readImprovedMessage({ improvedMessage: 'x' })).toBe('x');
    expect(readImprovedMessage('y')).toBe('y');
    expect(readImprovedMessage({ other: 1 })).toBeUndefined();
    expect(readImprovedMessage(undefined)).toBeUndefined();
  });
});
