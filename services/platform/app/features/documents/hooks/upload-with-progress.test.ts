import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadTimeoutError } from '../lib/upload-deadline';

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/convex/_generated/api', () => ({ api: {} }));

import { uploadWithProgress } from './mutations';

/**
 * Minimal scripted XMLHttpRequest double. Tests drive the upload lifecycle by
 * emitting the exact events the browser would (`upload.progress`,
 * `upload.load`, response `load`) and advancing fake timers between them.
 */
class FakeXhr {
  static current: FakeXhr | null = null;

  upload = { listeners: new Map<string, (e: unknown) => void>() } as {
    listeners: Map<string, (e: unknown) => void>;
    addEventListener?: unknown;
  };

  private listeners = new Map<string, () => void>();
  status = 0;
  responseText = '';
  statusText = '';
  aborted = false;

  constructor() {
    FakeXhr.current = this;
    this.upload.addEventListener = (type: string, fn: (e: unknown) => void) => {
      this.upload.listeners.set(type, fn);
    };
  }

  open(): void {}
  setRequestHeader(): void {}
  send(): void {}

  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, fn);
  }

  abort(): void {
    this.aborted = true;
    this.listeners.get('abort')?.();
  }

  emitProgress(loaded: number, total: number): void {
    this.upload.listeners.get('progress')?.({
      lengthComputable: true,
      loaded,
      total,
    });
  }

  emitUploadDone(): void {
    this.upload.listeners.get('load')?.({});
  }

  emitResponse(status: number): void {
    this.status = status;
    this.listeners.get('load')?.();
  }
}

function startUpload(onUploadPhaseDone?: () => void) {
  const file = new File(['x'], 'big.pdf', { type: 'application/pdf' });
  const promise = uploadWithProgress(
    'https://acc.r2.cloudflarestorage.com/bucket/key',
    file,
    'application/pdf',
    'PUT',
    undefined,
    () => {},
    onUploadPhaseDone,
  );
  // Swallow later assertions' rejections so an aborting test can inspect the
  // promise without an unhandled-rejection warning.
  promise.catch(() => {});
  return { promise, xhr: FakeXhr.current as unknown as FakeXhr };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeXhr.current = null;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('uploadWithProgress two-phase watchdog', () => {
  it('does not start a transfer after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const promise = uploadWithProgress(
      'https://acc.r2.cloudflarestorage.com/bucket/key',
      new File(['x'], 'big.pdf', { type: 'application/pdf' }),
      'application/pdf',
      'PUT',
      controller.signal,
      () => {},
    );

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.current).toBeNull();
  });

  it('reports the end of the upload phase so the UI can show "confirming"', async () => {
    const onUploadPhaseDone = vi.fn();
    const { promise, xhr } = startUpload(onUploadPhaseDone);
    xhr.emitProgress(100_000, 100_000);
    expect(onUploadPhaseDone).not.toHaveBeenCalled();
    xhr.emitUploadDone();
    expect(onUploadPhaseDone).toHaveBeenCalledTimes(1);
    xhr.emitResponse(200);
    await expect(promise).resolves.toEqual({});
  });

  it('still aborts a transfer with no progress for the stall window', async () => {
    const { promise, xhr } = startUpload();
    xhr.emitProgress(1_000, 100_000);
    vi.advanceTimersByTime(60_001);
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(UploadTimeoutError);
  });

  it('does NOT abort while waiting for the store response after the last byte', async () => {
    const { promise, xhr } = startUpload();
    xhr.emitProgress(100_000, 100_000);
    xhr.emitUploadDone();

    // The regression: on a slow uplink the buffers drain for minutes after
    // the bar reads 100 % and no further progress event ever fires. The old
    // 60 s inactivity window killed the request right here.
    vi.advanceTimersByTime(5 * 60_000);
    expect(xhr.aborted).toBe(false);

    xhr.emitResponse(200);
    await expect(promise).resolves.toEqual({});
  });

  it('aborts when even the response deadline passes with no answer', async () => {
    const { promise, xhr } = startUpload();
    xhr.emitProgress(100_000, 100_000);
    xhr.emitUploadDone();
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(UploadTimeoutError);
  });

  it('a late progress tick cannot shrink the response deadline back to 60s', async () => {
    const { promise, xhr } = startUpload();
    xhr.emitUploadDone();
    // Browsers may deliver a final buffered progress event after upload.load.
    xhr.emitProgress(100_000, 100_000);
    vi.advanceTimersByTime(2 * 60_000);
    expect(xhr.aborted).toBe(false);
    xhr.emitResponse(200);
    await expect(promise).resolves.toEqual({});
  });
});
