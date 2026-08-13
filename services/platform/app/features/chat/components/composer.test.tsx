// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
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
  attachAccept,
  transcriptionStatuses,
  onRetryTranscription,
  indexingStatuses,
  videoLinkJobs,
  onCancelVideoJob,
  onRetryVideoJob,
  onIngestVideoUrls,
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
  attachAccept?: string;
  transcriptionStatuses?: ComponentProps<
    typeof Composer
  >['transcriptionStatuses'];
  onRetryTranscription?: (fileId: string) => void;
  indexingStatuses?: ComponentProps<typeof Composer>['indexingStatuses'];
  videoLinkJobs?: ComponentProps<typeof Composer>['videoLinkJobs'];
  onCancelVideoJob?: (jobId: string) => void;
  onRetryVideoJob?: (jobId: string) => void;
  onIngestVideoUrls?: (text: string) => void;
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
        {...(attachAccept !== undefined ? { attachAccept } : {})}
        {...(transcriptionStatuses !== undefined
          ? { transcriptionStatuses }
          : {})}
        {...(onRetryTranscription !== undefined
          ? { onRetryTranscription }
          : {})}
        {...(indexingStatuses !== undefined ? { indexingStatuses } : {})}
        {...(videoLinkJobs !== undefined ? { videoLinkJobs } : {})}
        {...(onCancelVideoJob !== undefined ? { onCancelVideoJob } : {})}
        {...(onRetryVideoJob !== undefined ? { onRetryVideoJob } : {})}
        {...(onIngestVideoUrls !== undefined ? { onIngestVideoUrls } : {})}
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

  it('shows the effort as a separate word on the trigger, not jammed into the model', () => {
    const reasoningModel: ComposerModelOption = {
      ...MODEL,
      reasoning: { knob: 'budget-tokens' },
    };
    renderComposer({
      models: [reasoningModel],
      initial: {
        modelId: reasoningModel.id,
        providerSlug: reasoningModel.providerSlug,
        reasoningEffort: 'low',
      },
    });

    const trigger = screen.getByRole('button', {
      name: 'Choose model and reasoning effort',
    });
    expect(trigger).toHaveTextContent(/Claude Fable 5 Low/);
    expect(trigger).not.toHaveTextContent(/Fable 5Low/);
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
    fireEvent.click(
      await screen.findByRole('menuitemradio', { name: /^GLM-5/ }),
    );

    expect(selection()).toMatchObject({
      modelId: SECOND_MODEL.id,
      providerSlug: SECOND_MODEL.providerSlug,
    });
  });

  it('shows Auto on the trigger while the selection is the Auto mode', () => {
    renderComposer({
      models: [MODEL, SECOND_MODEL],
      initial: { modelSelection: 'auto' },
    });

    expect(
      screen.getByRole('button', { name: 'Choose model and reasoning effort' }),
    ).toHaveTextContent('Auto');
  });

  it('leads the model list with Auto when the catalog offers a choice', async () => {
    const { user, selection } = renderComposer({
      models: [MODEL, SECOND_MODEL],
      initial: { modelId: MODEL.id, providerSlug: MODEL.providerSlug },
    });

    await openSection(user, /^Model/);
    const auto = await screen.findByRole('menuitemradio', { name: 'Auto' });
    // The chosen state is programmatic, not just the check glyph.
    expect(auto).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(auto);

    expect(selection()).toEqual({ modelSelection: 'auto' });
  });

  it('offers no Auto row for a single-model catalog', async () => {
    const { user } = renderComposer({ models: [MODEL] });

    await openSection(user, /^Model/);
    await screen.findByRole('menuitemradio', { name: /^Claude Fable 5/ });
    expect(
      screen.queryByRole('menuitemradio', { name: 'Auto' }),
    ).not.toBeInTheDocument();
  });

  it('clears the reasoning effort when switching to Auto', async () => {
    const { user, selection } = renderComposer({
      models: [MODEL, SECOND_MODEL],
      initial: {
        modelId: MODEL.id,
        providerSlug: MODEL.providerSlug,
        reasoningEffort: 'max',
      },
    });

    await openSection(user, /^Model/);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Auto' }));

    // The whole selection collapses to the mode: no pinned model, no
    // provider, and no effort silently steering whatever Auto resolves.
    expect(selection()).toEqual({ modelSelection: 'auto' });
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

  it('passes an axe audit with the model list open (Auto row included)', async () => {
    const { user } = renderComposer({ models: [MODEL, SECOND_MODEL] });

    await openSection(user, /^Model/);
    await screen.findByRole('menuitemradio', { name: 'Auto' });
    // The menu portals into the body — audit the whole document, not just
    // the composer's own container. `region` is off: the harness renders no
    // page landmarks, so the portal outside them is an artifact of the test
    // page, not of the menu (the audited signal here is the row semantics —
    // roles, aria-checked, names).
    await waitFor(() =>
      checkAccessibility(document.body, {
        rules: { region: { enabled: false } },
      }),
    );
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

describe('Composer video links', () => {
  const JOB = {
    jobId: 'job1' as never,
    sourceUrl: 'https://youtu.be/abc',
    sourcePlatform: 'youtube',
    pastedToken: 'https://youtu.be/abc',
    videoTitle: 'Quarterly recap',
    displayStatus: 'fetching_captions',
    uploadedBy: 'user1',
    createdAt: 0,
  };

  it('renders a chip with the live ingest status and its source link', () => {
    renderComposer({
      models: [MODEL],
      onAttachFiles: vi.fn(),
      videoLinkJobs: [JOB],
    });

    expect(screen.getByText('Quarterly recap')).toBeInTheDocument();
    expect(screen.getByText('Fetching captions…')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Quarterly recap' }),
    ).toHaveAttribute('href', 'https://youtu.be/abc');
  });

  it('offers retry on a failed chip and forwards cancel', async () => {
    const onCancelVideoJob = vi.fn();
    const onRetryVideoJob = vi.fn();
    const { user } = renderComposer({
      models: [MODEL],
      onAttachFiles: vi.fn(),
      videoLinkJobs: [
        {
          ...JOB,
          displayStatus: 'failed',
          errorReasonCode: 'geoblocked',
          errorMessage: 'yt-dlp: ERROR 403 geo restriction (DE)',
        },
      ],
      onCancelVideoJob,
      onRetryVideoJob,
    });

    expect(
      screen.getByText("Video isn't available in this region"),
    ).toBeInTheDocument();
    // The verbatim failure detail sits behind a click-to-expand summary —
    // the localized reason answers "what", this answers "why exactly".
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(
      screen.getByText('yt-dlp: ERROR 403 geo restriction (DE)'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryVideoJob).toHaveBeenCalledWith('job1');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onCancelVideoJob).toHaveBeenCalledWith('job1');
  });

  it('hands pasted text to the video-URL ingest without eating the paste', () => {
    const onIngestVideoUrls = vi.fn();
    renderComposer({
      models: [MODEL],
      onAttachFiles: vi.fn(),
      onIngestVideoUrls,
    });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    fireEvent.paste(field, {
      clipboardData: {
        items: [],
        getData: (type: string) =>
          type === 'text/plain' ? 'watch https://youtu.be/abc' : '',
      },
    });

    expect(onIngestVideoUrls).toHaveBeenCalledWith(
      'watch https://youtu.be/abc',
    );
  });

  it('ingests a video URL dropped as text onto the composer', () => {
    const onIngestVideoUrls = vi.fn();
    renderComposer({
      models: [MODEL],
      onAttachFiles: vi.fn(),
      onIngestVideoUrls,
    });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    fireEvent.drop(field, {
      dataTransfer: {
        files: [],
        types: ['text/uri-list'],
        getData: (type: string) =>
          type === 'text/uri-list' ? 'https://youtu.be/abc' : '',
      },
    });

    expect(onIngestVideoUrls).toHaveBeenCalledWith('https://youtu.be/abc');
  });

  it('makes a staged video link sendable without any text', async () => {
    const onSend = vi.fn();
    const { user } = renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id },
      onSend,
      onAttachFiles: vi.fn(),
      videoLinkJobs: [{ ...JOB, displayStatus: 'completed' }],
    });

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(onSend).toHaveBeenCalledWith('');
  });
});

describe('Composer drag-drop attachments', () => {
  function dropFiles(target: HTMLElement, files: File[]) {
    fireEvent.drop(target, {
      dataTransfer: { files, types: ['Files'], getData: () => '' },
    });
  }

  it('stages dropped files through the attach lane', () => {
    const onAttachFiles = vi.fn();
    renderComposer({ models: [MODEL], onAttachFiles });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    dropFiles(field, [pdf]);

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    const [files] = onAttachFiles.mock.calls[0] as [File[]];
    expect(files.map((file) => file.name)).toEqual(['report.pdf']);
  });

  it('shows the drop overlay while dragging over and clears it after the drop', () => {
    renderComposer({ models: [MODEL], onAttachFiles: vi.fn() });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    fireEvent.dragOver(field, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop files here to upload')).toBeInTheDocument();

    dropFiles(field, [new File(['x'], 'a.txt', { type: 'text/plain' })]);
    expect(
      screen.queryByText('Drop files here to upload'),
    ).not.toBeInTheDocument();
  });

  it('stays inert when the surface offers no attach lane', () => {
    renderComposer({ models: [MODEL] });
    const field = screen.getByRole('textbox', { name: 'Message input' });

    fireEvent.dragOver(field, { dataTransfer: { types: ['Files'] } });
    expect(
      screen.queryByText('Drop files here to upload'),
    ).not.toBeInTheDocument();
    expect(() =>
      dropFiles(field, [new File(['x'], 'a.txt', { type: 'text/plain' })]),
    ).not.toThrow();
  });

  it('offers the picker the full chat family by default, or the policy filter', () => {
    const { container, unmount } = renderComposer({
      models: [MODEL],
      onAttachFiles: vi.fn(),
    });
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"][hidden]')
        ?.accept,
    ).toBe(CHAT_UPLOAD_ACCEPT);
    unmount();

    const { container: scoped } = renderComposer({
      models: [MODEL],
      onAttachFiles: vi.fn(),
      attachAccept: '.pdf,.docx',
    });
    expect(
      scoped.querySelector<HTMLInputElement>('input[type="file"][hidden]')
        ?.accept,
    ).toBe('.pdf,.docx');
  });
});

describe('Composer document attachments', () => {
  const DOCUMENT = {
    fileId: 'doc1',
    fileName: 'report.pdf',
    fileType: 'application/pdf',
    fileSize: 64_000,
  };

  it('renders a document chip with the live indexing status', () => {
    renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id },
      onAttachFiles: vi.fn(),
      attachments: [DOCUMENT],
      indexingStatuses: new Map([['doc1', { status: 'running' }]]),
    });

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('Indexing…')).toBeInTheDocument();
  });

  it('surfaces an indexing failure with the stored reason on hover', () => {
    renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id },
      onAttachFiles: vi.fn(),
      attachments: [DOCUMENT],
      indexingStatuses: new Map([
        ['doc1', { status: 'failed', error: 'no extractor' }],
      ]),
    });

    const label = screen.getByText('Index failed');
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('title', 'no extractor');
  });

  it('shows the file size once indexing settles, and removes from the chip', async () => {
    const onRemoveAttachment = vi.fn();
    const { user } = renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id },
      onAttachFiles: vi.fn(),
      onRemoveAttachment,
      attachments: [DOCUMENT],
      indexingStatuses: new Map([['doc1', { status: 'completed' }]]),
    });

    expect(screen.getByText('62.5 KB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove attachment' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith('doc1');
  });

  it('does not warn about vision for document-only stages', () => {
    renderComposer({
      models: [MODEL],
      initial: { modelId: MODEL.id, providerSlug: MODEL.providerSlug },
      onAttachFiles: vi.fn(),
      attachments: [DOCUMENT],
    });

    expect(
      screen.queryByText(
        "This model can't view images — it only sees their file names.",
      ),
    ).not.toBeInTheDocument();
  });
});
