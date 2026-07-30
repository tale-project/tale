// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type { ComposerModelOption, ComposerSelection } from '../types';
import { Composer } from './composer';

// The stated-block path raises its reason as a toast (module-level `toast`,
// not the hook) — spy on it without losing the module's other exports.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('@/app/hooks/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-toast')>()),
  toast: toastSpy,
}));

// jsdom has no Web Speech API; a supported recognizer keeps the dictation
// button rendered here. Its own behaviour is pinned by
// dictation-button.test.tsx — this file only asserts the composer offers it.
vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: true,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));

const MODEL: ComposerModelOption = {
  id: 'anthropic/claude-fable-5',
  label: 'Claude Fable 5',
  providerSlug: 'openrouter',
  credential: { authMethod: 'api-key' },
};

const SECOND_MODEL: ComposerModelOption = {
  id: 'zai/glm-5',
  label: 'GLM-5',
  providerSlug: 'zai',
  credential: { authMethod: 'env' },
};

// Drafts persist in localStorage — each render gets its own conversation key
// (and the store resets between tests) so text never leaks across cases.
let draftSeq = 0;
beforeEach(() => {
  localStorage.clear();
  toastSpy.mockClear();
});

/** Renders the composer with real selection state so picks stick. */
function renderComposer({
  models = [MODEL],
  initial = {},
  onSend = vi.fn(),
  onStop = vi.fn(),
  generating = false,
  sendDisabled = false,
  sendBlockedReason,
  quotedText = null,
  onQuotedTextChange,
  onVoiceOutputChange = vi.fn(),
}: {
  models?: ComposerModelOption[];
  initial?: ComposerSelection;
  onSend?: (text: string) => void;
  onStop?: () => void;
  generating?: boolean;
  sendDisabled?: boolean;
  sendBlockedReason?: string;
  quotedText?: string | null;
  onQuotedTextChange?: (next: string | null) => void;
  onVoiceOutputChange?: (next: boolean) => void;
} = {}) {
  const seen: ComposerSelection[] = [];
  const draftKey = `chat-draft-test-${++draftSeq}`;

  function Harness() {
    const [selection, setSelection] = useState(initial);
    seen.push(selection);
    return (
      <Composer
        draftKey={draftKey}
        models={models}
        selection={selection}
        onSelectionChange={setSelection}
        onSend={onSend}
        onStop={onStop}
        generating={generating}
        sendDisabled={sendDisabled}
        {...(sendBlockedReason !== undefined ? { sendBlockedReason } : {})}
        quotedText={quotedText}
        {...(onQuotedTextChange !== undefined ? { onQuotedTextChange } : {})}
        voiceOutput={false}
        onVoiceOutputChange={onVoiceOutputChange}
        arenaActive={false}
        onArenaChange={vi.fn()}
      />
    );
  }

  return {
    ...render(<Harness />),
    selection: () => seen[seen.length - 1],
    draftKey,
  };
}

/** Open the one picker, then one of its section submenus. */
async function openSection(
  user: ReturnType<typeof renderComposer>['user'],
  name: RegExp,
) {
  await user.click(
    screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
  );
  await user.click(screen.getByRole('menuitem', { name }));
}

describe('Composer model picker', () => {
  it('shows the picked model on the trigger', () => {
    renderComposer({
      initial: { modelId: MODEL.id, providerSlug: MODEL.providerSlug },
    });

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('Claude Fable 5');
  });

  it('invites a pick when options exist and nothing is selected', () => {
    renderComposer();

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('Select model');
  });

  it('claims no models only when the menu is truly empty', () => {
    renderComposer({ models: [] });

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('No models available');
  });

  it('lists the models under the Model section, and a pick sticks', async () => {
    const { user, selection } = renderComposer({
      models: [MODEL, SECOND_MODEL],
    });

    await openSection(user, /^Model/);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^GLM-5/ }));

    expect(selection()).toMatchObject({
      modelId: SECOND_MODEL.id,
      providerSlug: SECOND_MODEL.providerSlug,
    });
  });
});

describe('Composer voice toggle', () => {
  it('shows the read-aloud state at a glance on a dedicated button', () => {
    renderComposer();

    expect(screen.getByRole('button', { name: 'Voice mode' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('reports the read-replies-aloud toggle to its server-backed owner', async () => {
    const onVoiceOutputChange = vi.fn();
    const { user } = renderComposer({ onVoiceOutputChange });

    await user.click(screen.getByRole('button', { name: 'Voice mode' }));

    expect(onVoiceOutputChange).toHaveBeenCalledWith(true);
  });
});

describe('Composer sending', () => {
  it('sends on Enter and clears the field', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({ onSend });

    const field = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(field, 'hello there{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello there');
    expect(field).toHaveValue('');
  });

  it('breaks the line on Shift+Enter instead of sending', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({ onSend });

    const field = screen.getByRole('textbox', { name: 'Message input' });
    await user.type(field, 'first line{Shift>}{Enter}{/Shift}second line');

    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('first line\nsecond line');
  });

  it('keeps an empty message unsendable', () => {
    renderComposer();

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('offers stop instead of send while a turn is in flight', async () => {
    const onStop = vi.fn();
    const { user } = renderComposer({ generating: true, onStop });

    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop generating' }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('ignores Enter while an IME composition is committing', () => {
    const onSend = vi.fn();
    renderComposer({ onSend });
    const field = screen.getByRole('textbox', { name: 'Message input' });
    fireEvent.change(field, { target: { value: '你好' } });

    // The three guards: the WHATWG flag, the legacy Safari keyCode, and the
    // composition-event mirror for browsers that surface neither.
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'Enter', keyCode: 229 });
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('你好');
  });

  it('normalizes gappy copied chat text on paste', async () => {
    const { user } = renderComposer();
    const field = screen.getByRole('textbox', { name: 'Message input' });

    await user.click(field);
    await user.paste('para one\n\n\n\npara two  \n');

    expect(field).toHaveValue('para one\n\npara two');
  });
});

describe('Composer draft', () => {
  it('keeps a half-typed message across a remount of the same conversation', async () => {
    const first = renderComposer();
    await first.user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'half-typed thought',
    );
    first.unmount();

    render(
      <Composer
        draftKey={first.draftKey}
        models={[MODEL]}
        selection={{}}
        onSelectionChange={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue(
      'half-typed thought',
    );
  });
});

describe('Composer quoting', () => {
  it('stages the quote as a chip and prepends it as a blockquote on send', async () => {
    const onSend = vi.fn();
    const onQuotedTextChange = vi.fn();
    const { user } = renderComposer({
      onSend,
      onQuotedTextChange,
      quotedText: 'line one\nline two',
    });

    expect(screen.getByText('Quoted')).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'my reply{Enter}',
    );

    expect(onSend).toHaveBeenCalledWith('> line one\n> line two\n\nmy reply');
    expect(onQuotedTextChange).toHaveBeenCalledWith(null);
  });

  it('removes the staged quote from its chip', async () => {
    const onQuotedTextChange = vi.fn();
    const { user } = renderComposer({
      onQuotedTextChange,
      quotedText: 'quoted bit',
    });

    await user.click(screen.getByRole('button', { name: 'Remove quote' }));

    expect(onQuotedTextChange).toHaveBeenCalledWith(null);
  });
});

describe('Composer send blocks', () => {
  it('explains a stated block on Enter instead of a silent no-op', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({
      onSend,
      sendBlockedReason: 'Usage limit reached.',
    });

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'try to send{Enter}',
    );

    expect(onSend).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Usage limit reached.',
        variant: 'destructive',
      }),
    );
  });
});

describe('Composer dictation', () => {
  it('offers dictation beside send', () => {
    renderComposer();

    expect(
      screen.getByRole('button', { name: 'Start dictation' }),
    ).toBeInTheDocument();
  });
});

describe('Composer accessibility', () => {
  it('passes an axe audit', async () => {
    const { container } = renderComposer();
    await waitFor(() => checkAccessibility(container));
  });

  it('names every control', () => {
    renderComposer();

    expect(
      screen.getByRole('button', { name: 'Open chat menu' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Voice mode' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start dictation' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeInTheDocument();
  });

  it('blocks only the send button under sendDisabled, keeping the rest usable', async () => {
    const { user } = renderComposer({ sendDisabled: true });

    await user.type(
      screen.getByRole('textbox', { name: 'Message input' }),
      'Hi',
    );

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('textbox', { name: 'Message input' }),
    ).toBeEnabled();
  });
});
