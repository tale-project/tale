// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState, type ComponentProps } from 'react';
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

// The staged-attachment thumbnails resolve a server URL only as a fallback
// (their object-URL preview serves the common case); there is no Convex
// provider under this harness, so the query seam answers inert.
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
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
  stopPending = false,
  sendDisabled = false,
  sendBlockedReason,
  quotedText = null,
  onQuotedTextChange,
  onVoiceOutputChange = vi.fn(),
  attachments,
  uploadingAttachments,
  onAttachFiles,
  onRemoveAttachment,
  onCancelAttachmentUpload,
  transcriptionStatuses,
  onRetryTranscription,
}: {
  models?: ComposerModelOption[];
  initial?: ComposerSelection;
  onSend?: (text: string) => void;
  onStop?: () => void;
  generating?: boolean;
  stopPending?: boolean;
  sendDisabled?: boolean;
  sendBlockedReason?: string;
  quotedText?: string | null;
  onQuotedTextChange?: (next: string | null) => void;
  onVoiceOutputChange?: (next: boolean) => void;
  attachments?: ComponentProps<typeof Composer>['attachments'];
  uploadingAttachments?: readonly string[];
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (fileId: string) => void;
  onCancelAttachmentUpload?: (fileId: string) => void;
  transcriptionStatuses?: ComponentProps<
    typeof Composer
  >['transcriptionStatuses'];
  onRetryTranscription?: (fileId: string) => void;
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
        stopPending={stopPending}
        sendDisabled={sendDisabled}
        {...(sendBlockedReason !== undefined ? { sendBlockedReason } : {})}
        quotedText={quotedText}
        {...(onQuotedTextChange !== undefined ? { onQuotedTextChange } : {})}
        {...(attachments !== undefined ? { attachments } : {})}
        {...(uploadingAttachments !== undefined
          ? { uploadingAttachments }
          : {})}
        {...(onAttachFiles !== undefined ? { onAttachFiles } : {})}
        {...(onRemoveAttachment !== undefined ? { onRemoveAttachment } : {})}
        {...(onCancelAttachmentUpload !== undefined
          ? { onCancelAttachmentUpload }
          : {})}
        {...(transcriptionStatuses !== undefined
          ? { transcriptionStatuses }
          : {})}
        {...(onRetryTranscription !== undefined
          ? { onRetryTranscription }
          : {})}
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

  it('acknowledges a clicked Stop instantly with the pending state', () => {
    renderComposer({ generating: true, stopPending: true });

    const stopping = screen.getByRole('button', { name: 'Stopping…' });
    expect(stopping).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Stop generating' }),
    ).toBeNull();
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

describe('Composer image attachments', () => {
  const VISION_MODEL: ComposerModelOption = { ...MODEL, vision: true };
  const STAGED = {
    fileId: 'blob1',
    fileName: 'shot.png',
    fileType: 'image/png',
    fileSize: 4096,
    previewUrl: 'blob:preview-1',
  };

  function pasteImage(field: HTMLElement, name = 'clip.png') {
    fireEvent.paste(field, {
      clipboardData: {
        items: [
          {
            type: 'image/png',
            getAsFile: () =>
              new File(['png-bytes'], name, { type: 'image/png' }),
          },
        ],
        getData: () => '',
      },
    });
  }

  it('attaches a pasted image instead of pasting its text fallback', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ models: [VISION_MODEL], onAttachFiles });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    pasteImage(field);

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    const [files] = onAttachFiles.mock.calls[0] as [File[]];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('pasted-image-1.png');
    expect(files[0]?.type).toBe('image/png');
    expect(field).toHaveValue('');
  });

  it('numbers repeated pastes so dedup never eats a second screenshot', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ models: [VISION_MODEL], onAttachFiles });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    pasteImage(field);
    pasteImage(field);

    const names = onAttachFiles.mock.calls.map(
      (call) => (call[0] as File[])[0]?.name,
    );
    expect(names).toEqual(['pasted-image-1.png', 'pasted-image-2.png']);
  });

  it('leaves image pastes alone when the surface offers no attach lane', () => {
    renderComposer();
    const field = screen.getByRole('textbox', { name: 'Message input' });

    // No onAttachFiles: the paste falls through to the text path (which
    // finds no text) — nothing attaches, nothing crashes.
    expect(() => pasteImage(field)).not.toThrow();
  });

  it('makes staged images sendable without any text', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({
      models: [VISION_MODEL],
      initial: { modelId: VISION_MODEL.id },
      onSend,
      onAttachFiles: vi.fn(),
      attachments: [STAGED],
    });

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith('');
  });

  it('holds the send while an upload is in flight', () => {
    renderComposer({
      models: [VISION_MODEL],
      initial: { modelId: VISION_MODEL.id },
      onAttachFiles: vi.fn(),
      attachments: [STAGED],
      uploadingAttachments: ['pending-upload'],
    });

    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
  });

  it('removes a staged image from its chip', async () => {
    const onRemoveAttachment = vi.fn();
    const { user } = renderComposer({
      models: [VISION_MODEL],
      onAttachFiles: vi.fn(),
      onRemoveAttachment,
      attachments: [STAGED],
    });

    await user.click(screen.getByRole('button', { name: 'Remove attachment' }));

    expect(onRemoveAttachment).toHaveBeenCalledWith('blob1');
  });

  it('warns when the picked model cannot see the staged images', () => {
    renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id, providerSlug: MODEL.providerSlug },
      onAttachFiles: vi.fn(),
      attachments: [STAGED],
    });

    expect(
      screen.getByText(
        "This model can't view images — it only sees their file names.",
      ),
    ).toBeInTheDocument();
  });

  it('stays quiet when the picked model has vision', () => {
    renderComposer({
      models: [VISION_MODEL],
      initial: { modelId: VISION_MODEL.id, providerSlug: MODEL.providerSlug },
      onAttachFiles: vi.fn(),
      attachments: [STAGED],
    });

    expect(
      screen.queryByText(
        "This model can't view images — it only sees their file names.",
      ),
    ).not.toBeInTheDocument();
  });

  it('offers the attach entry in the + menu', async () => {
    const { user } = renderComposer({
      models: [VISION_MODEL],
      onAttachFiles: vi.fn(),
    });

    await user.click(screen.getByRole('button', { name: 'Open chat menu' }));

    expect(
      screen.getByRole('menuitem', { name: 'Add photos & files' }),
    ).toBeInTheDocument();
  });
});

describe('Composer audio attachments', () => {
  const AUDIO = {
    fileId: 'audio1',
    fileName: 'meeting.mp3',
    fileType: 'audio/mpeg',
    fileSize: 128_000,
  };

  it('renders a media chip with the live transcription status', () => {
    renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id },
      onAttachFiles: vi.fn(),
      attachments: [AUDIO],
      transcriptionStatuses: new Map([
        ['audio1', { status: 'running', progress: 'transcribing' }],
      ]),
    });

    expect(screen.getByText('meeting.mp3')).toBeInTheDocument();
    expect(screen.getByText('transcribing')).toBeInTheDocument();
  });

  it('offers retry when transcription failed', async () => {
    const onRetryTranscription = vi.fn();
    const { user } = renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id },
      onAttachFiles: vi.fn(),
      onRetryTranscription,
      attachments: [AUDIO],
      transcriptionStatuses: new Map([
        ['audio1', { status: 'failed', error: 'provider down' }],
      ]),
    });

    expect(screen.getByText("Couldn't transcribe")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryTranscription).toHaveBeenCalledWith('audio1');
  });

  it('does not warn about vision for audio-only stages', () => {
    renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id, providerSlug: MODEL.providerSlug },
      onAttachFiles: vi.fn(),
      attachments: [AUDIO],
      transcriptionStatuses: new Map([
        ['audio1', { status: 'completed', transcript: 'hi' }],
      ]),
    });

    expect(
      screen.queryByText(
        "This model can't view images — it only sees their file names.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Transcribed')).toBeInTheDocument();
  });
});
