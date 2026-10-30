// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type { ComposerModelOption } from '../types';
import { Composer, DICTATION_FINISH_TIMEOUT_MS } from './composer';

// Sending while dictating: what the dictation still owes when Send is
// pressed — the recognizer's pending results, the server fallback's
// transcription — belongs to the message. The composer runs here with the
// real dictation button and hooks over fake browser APIs, so each path is
// driven the way a browser drives it.

const { toastSpy, transcribe } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  transcribe: vi.fn(),
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: toastSpy,
}));
vi.mock('@/app/lib/backend/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/chat')>()),
  transcribeDictationRequest: transcribe,
}));
// jsdom has no AudioContext: the level meter and the tones have their own
// units.
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('../utils/dictation-sounds', () => ({
  playDictationStartSound: vi.fn(),
  playDictationStopSound: vi.fn(),
}));

const MODEL: ComposerModelOption = {
  id: 'anthropic/claude-fable-5',
  label: 'Claude Fable 5',
  providerSlug: 'openrouter',
  credential: { authMethod: 'api-key' },
};
const ORG_ID = 'org_test';

/** Web Speech as Chrome runs it: the test speaks for the recognizer. */
class FakeRecognition extends EventTarget {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    super();
    FakeRecognition.instances.push(this);
  }
}

function recognizer(): FakeRecognition {
  const recognition = FakeRecognition.instances.at(-1);
  if (recognition === undefined) throw new Error('No recognition started');
  return recognition;
}

/** A `result` event carrying one final transcript. */
function finalResult(transcript: string): Event {
  const event = new Event('result');
  const result = Object.assign([{ transcript, confidence: 1 }], {
    isFinal: true,
  });
  return Object.assign(event, { resultIndex: 0, results: [result] });
}

/** MediaRecorder as Firefox runs it: the test delivers its events. */
class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/ogg';
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  constructor() {
    super();
    FakeMediaRecorder.instances.push(this);
  }
}

function recorder(): FakeMediaRecorder {
  const instance = FakeMediaRecorder.instances.at(-1);
  if (instance === undefined) throw new Error('No recording started');
  return instance;
}

function installWebSpeech() {
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  Object.defineProperty(navigator, 'permissions', {
    value: { query: () => Promise.resolve({ state: 'granted' }) },
    configurable: true,
  });
}

function installRecorder() {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }),
    },
    configurable: true,
  });
}

let draftSeq = 0;
beforeEach(() => {
  FakeRecognition.instances = [];
  FakeMediaRecorder.instances = [];
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: undefined,
    configurable: true,
  });
  toastSpy.mockReset();
  transcribe.mockReset();
});

function renderComposer() {
  const onSend = vi.fn();
  const view = render(
    <Composer
      draftKey={`chat-dictation-test-${++draftSeq}`}
      models={[MODEL]}
      selection={{ modelId: MODEL.id }}
      onSelectionChange={vi.fn()}
      onSend={onSend}
      organizationId={ORG_ID}
      transcriptionAvailable
    />,
  );
  const field = screen.getByRole('textbox', { name: 'Message input' });
  return { ...view, onSend, field };
}

function expectNotSentToast(description: RegExp) {
  expect(toastSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Message not sent',
      description: expect.stringMatching(description),
      variant: 'destructive',
    }),
  );
}

describe('Composer — sending while the browser recognizes speech', () => {
  /** Type `typed`, start dictating, and hear `heard` finalized. */
  async function dictate(typed: string, heard?: string) {
    installWebSpeech();
    const composer = renderComposer();
    if (typed !== '') await composer.user.type(composer.field, typed);
    await composer.user.click(
      screen.getByRole('button', { name: 'Start dictation' }),
    );
    act(() => {
      recognizer().dispatchEvent(new Event('start'));
    });
    if (heard !== undefined) {
      act(() => {
        recognizer().dispatchEvent(finalResult(heard));
      });
    }
    return composer;
  }

  it('sends the words the recognizer finalizes after Send with the rest of the message', async () => {
    const { user, field, onSend } = await dictate(
      'Please summarise',
      'the report',
    );
    expect(field).toHaveValue('Please summarise the report');

    await user.type(field, '{Enter}');

    // The mic stops, and the send waits for what it still owes.
    expect(recognizer().stop).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Finishing transcription…' }),
    ).toBeDisabled();
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Finishing transcription…',
    );

    act(() => {
      recognizer().dispatchEvent(finalResult('for March'));
    });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => {
      recognizer().dispatchEvent(new Event('end'));
    });

    expect(onSend).toHaveBeenCalledExactlyOnceWith(
      'Please summarise the report for March',
    );
    expect(field).toHaveValue('');
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });

  it('offers Send while dictating into an empty field, and sends what was said', async () => {
    const { user, field, onSend } = await dictate('');
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(field).toHaveValue('');
    expect(send).toBeEnabled();

    await user.click(send);
    act(() => {
      recognizer().dispatchEvent(finalResult('Book the meeting room'));
    });
    await act(async () => {
      recognizer().dispatchEvent(new Event('end'));
    });

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Book the meeting room');
  });

  it('sends nothing when only silence followed', async () => {
    const { user, onSend } = await dictate('');

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await act(async () => {
      const silence = Object.assign(new Event('error'), {
        error: 'no-speech',
      });
      recognizer().dispatchEvent(silence);
      recognizer().dispatchEvent(new Event('end'));
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('sends nothing when the recognizer fails before its last words, and keeps the field', async () => {
    const { user, field, onSend } = await dictate(
      'Please summarise',
      'the report',
    );

    await user.type(field, '{Enter}');
    await act(async () => {
      const failure = Object.assign(new Event('error'), { error: 'network' });
      recognizer().dispatchEvent(failure);
      recognizer().dispatchEvent(new Event('end'));
    });

    expect(onSend).not.toHaveBeenCalled();
    expectNotSentToast(/could not be transcribed/);
    expect(field).toHaveValue('Please summarise the report');
    expect(field).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('gives up after the timeout and sends nothing; words that arrive later wait in the field', async () => {
    const { field, onSend } = await dictate('Please summarise', 'the report');

    vi.useFakeTimers();
    fireEvent.keyDown(field, { key: 'Enter' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DICTATION_FINISH_TIMEOUT_MS);
    });

    expect(onSend).not.toHaveBeenCalled();
    expectNotSentToast(/taking too long/);
    expect(field).not.toHaveAttribute('readonly');

    act(() => {
      recognizer().dispatchEvent(finalResult('for March'));
      recognizer().dispatchEvent(new Event('end'));
    });
    expect(field).toHaveValue('Please summarise the report for March');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('Composer — sending while recording for server transcription', () => {
  /** Type `typed`, start recording, and capture some audio. */
  async function record(typed: string) {
    installRecorder();
    const composer = renderComposer();
    await composer.user.type(composer.field, typed);
    await composer.user.click(
      screen.getByRole('button', { name: 'Start dictation' }),
    );
    await screen.findByRole('button', { name: 'Stop dictation' });
    act(() => {
      const chunk = Object.assign(new Event('dataavailable'), {
        data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/ogg' }),
      });
      recorder().dispatchEvent(chunk);
    });
    return composer;
  }

  it('sends the transcript of the recording that Send stopped', async () => {
    transcribe.mockResolvedValue({ text: 'call the bank' });
    const { user, field, onSend } = await record('Note:');

    await user.type(field, '{Enter}');

    expect(recorder().stop).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Finishing transcription…' }),
    ).toBeDisabled();

    await act(async () => {
      recorder().dispatchEvent(new Event('stop'));
    });

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledExactlyOnceWith('Note: call the bank'),
    );
    expect(transcribe).toHaveBeenCalledOnce();
    expect(field).toHaveValue('');
  });

  it('waits for a transcription already under way when Send follows Stop dictation', async () => {
    let deliver!: (body: { text: string }) => void;
    transcribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const { user, field, onSend } = await record('Note:');

    await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
    await act(async () => {
      recorder().dispatchEvent(new Event('stop'));
    });
    expect(
      screen.getByRole('button', { name: 'Transcribing…' }),
    ).toBeInTheDocument();

    await user.type(field, '{Enter}');
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => {
      deliver({ text: 'call the bank' });
    });

    await waitFor(() =>
      expect(onSend).toHaveBeenCalledExactlyOnceWith('Note: call the bank'),
    );
  });

  it('sends nothing when the recording cannot be transcribed, and keeps it for a retry', async () => {
    transcribe.mockRejectedValueOnce(new Error('provider 500'));
    const { user, field, onSend } = await record('Note:');

    await user.type(field, '{Enter}');
    await act(async () => {
      recorder().dispatchEvent(new Event('stop'));
    });

    await waitFor(() => expectNotSentToast(/could not be transcribed/));
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('Note:');
    expect(screen.getByText('Transcription failed')).toBeInTheDocument();

    // A retry adds the words to the field; sending stays the person's call.
    transcribe.mockResolvedValueOnce({ text: 'call the bank' });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(field).toHaveValue('Note: call the bank'));
    expect(onSend).not.toHaveBeenCalled();
  });
});
