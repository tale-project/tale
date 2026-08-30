// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';

const mocks = vi.hoisted(() => ({
  generateBlobUpload: vi.fn(),
  createDocumentFromUpload: vi.fn(),
  beginControlledDocumentReplacementUpload: vi.fn(),
  finalizeControlledDocumentReplacementUpload: vi.fn(),
  reconcileControlledDocumentReplacementUpload: vi.fn(),
  registerControlledDocumentReplacementUpload: vi.fn(),
  cancelControlledDocumentReplacementUpload: vi.fn(),
  deleteRejectedUploadBlob: vi.fn(),
  toast: vi.fn(),
  calculateFileHash: vi.fn(),
}));
const protocolEvents: string[] = [];

vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mocks.toast(...args),
}));

vi.mock('@/lib/utils/file-hash', () => ({
  calculateFileHash: (...args: unknown[]) => mocks.calculateFileHash(...args),
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (reference: string) => {
    const mutateAsync = {
      'files/blob_actions:generateBlobUpload': mocks.generateBlobUpload,
      'documents/record_actions:beginControlledDocumentReplacementUpload':
        mocks.beginControlledDocumentReplacementUpload,
      'documents/record_actions:finalizeControlledDocumentReplacementUpload':
        mocks.finalizeControlledDocumentReplacementUpload,
      'documents/record_actions:reconcileControlledDocumentReplacementUpload':
        mocks.reconcileControlledDocumentReplacementUpload,
    }[reference];
    return { mutateAsync };
  },
}));

vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (reference: string) => {
    const mutateAsync = {
      'documents/mutations:createDocumentFromUpload':
        mocks.createDocumentFromUpload,
      'documents/replacement_uploads:registerControlledDocumentReplacementUpload':
        mocks.registerControlledDocumentReplacementUpload,
      'documents/replacement_uploads:cancelControlledDocumentReplacementUpload':
        mocks.cancelControlledDocumentReplacementUpload,
      'files/mutations:deleteRejectedUploadBlob':
        mocks.deleteRejectedUploadBlob,
    }[reference];
    return { mutateAsync };
  },
}));

import { UploadTimeoutError } from '../lib/upload-deadline';
import { useDocumentUpload } from './mutations';

class FakeXhr {
  static instances: FakeXhr[] = [];

  upload = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      this.uploadListeners.set(type, listener);
    },
  };

  status = 0;
  statusText = '';
  responseText = '';
  aborted = false;
  method = '';
  url = '';
  sentBody: unknown;
  requestHeaders = new Map<string, string>();

  private uploadListeners = new Map<string, (event: unknown) => void>();
  private listeners = new Map<string, () => void>();

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.set(name, value);
  }

  send(body: unknown): void {
    this.sentBody = body;
    protocolEvents.push('upload');
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.listeners.get('abort')?.();
  }

  emitUploadDone(): void {
    this.uploadListeners.get('load')?.({});
  }

  emitResponse(status: number, responseText = ''): void {
    this.status = status;
    this.statusText = status >= 400 ? 'Rejected' : 'OK';
    this.responseText = responseText;
    this.listeners.get('load')?.();
  }
}

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'application/pdf' });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  protocolEvents.length = 0;
  FakeXhr.instances = [];
  let uploadNumber = 0;
  mocks.generateBlobUpload.mockImplementation(async () => {
    uploadNumber += 1;
    return {
      url: `https://uploads.test/${uploadNumber}`,
      method: 'PUT',
      s3Ref: `s3:test/${uploadNumber}`,
    };
  });
  mocks.createDocumentFromUpload.mockResolvedValue(undefined);
  let replacementNumber = 0;
  mocks.beginControlledDocumentReplacementUpload.mockImplementation(
    async () => {
      replacementNumber += 1;
      return {
        intentId: `intent-${replacementNumber}`,
        url: `https://replacement.test/${replacementNumber}`,
        method: 'PUT',
        uploadContentType: 'application/pdf',
        uploadExpiresAt: Date.now() + 60_000,
      };
    },
  );
  mocks.finalizeControlledDocumentReplacementUpload.mockResolvedValue({
    version: 2,
  });
  mocks.reconcileControlledDocumentReplacementUpload.mockResolvedValue({
    state: 'bound',
    resultVersion: 2,
    cleanupPending: false,
    updatedAt: Date.now(),
  });
  mocks.registerControlledDocumentReplacementUpload.mockResolvedValue(null);
  mocks.cancelControlledDocumentReplacementUpload.mockResolvedValue({
    state: 'cancelled',
  });
  mocks.deleteRejectedUploadBlob.mockResolvedValue(undefined);
  mocks.calculateFileHash.mockResolvedValue('sha256:test');
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDocumentUpload operation ownership', () => {
  it('accepts only one of two synchronous retries for the same file', async () => {
    const { result } = renderHook(() =>
      useDocumentUpload({ organizationId: 'org-1' }),
    );
    act(() => result.current.stageFiles([makeFile('retry.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let initialUpload!: Promise<{ success: boolean }>;
    act(() => {
      initialUpload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => FakeXhr.instances[0].emitResponse(500));
    await act(async () => {
      expect((await initialUpload).success).toBe(false);
    });
    await waitFor(() =>
      expect(result.current.trackedFiles[0]?.status).toBe('failed'),
    );

    const fileId = result.current.trackedFiles[0]?.id;
    expect(fileId).toBeDefined();
    let firstRetry!: Promise<boolean>;
    let secondRetry!: Promise<boolean>;
    act(() => {
      firstRetry = result.current.retryFile(fileId);
      secondRetry = result.current.retryFile(fileId);
    });

    await expect(secondRetry).resolves.toBe(false);
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    expect(FakeXhr.instances).toHaveLength(2);

    act(() => {
      FakeXhr.instances[1].emitUploadDone();
      FakeXhr.instances[1].emitResponse(200);
    });
    await act(async () => {
      expect(await firstRetry).toBe(true);
    });
    expect(mocks.createDocumentFromUpload).toHaveBeenCalledOnce();
  });

  it('keeps uploadFiles ownership until its batch settles, then allows retryAllFailed', async () => {
    const { result } = renderHook(() =>
      useDocumentUpload({ organizationId: 'org-1' }),
    );
    act(() =>
      result.current.stageFiles([
        makeFile('first.pdf'),
        makeFile('second.pdf'),
      ]),
    );
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(2));

    let uploadBatch!: Promise<{ success: boolean }>;
    act(() => {
      uploadBatch = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    act(() => FakeXhr.instances[0].emitResponse(500));
    await flushMicrotasks();
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    await waitFor(() =>
      expect(
        result.current.trackedFiles.some((file) => file.status === 'failed'),
      ).toBe(true),
    );

    await expect(result.current.retryAllFailed()).resolves.toBe(false);
    expect(FakeXhr.instances).toHaveLength(2);

    act(() => {
      FakeXhr.instances[1].emitUploadDone();
      FakeXhr.instances[1].emitResponse(200);
    });
    await act(async () => {
      expect((await uploadBatch).success).toBe(false);
    });
    await waitFor(() => expect(result.current.isUploading).toBe(false));

    let retryFailed!: Promise<boolean>;
    act(() => {
      retryFailed = result.current.retryAllFailed();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(3));
    act(() => {
      FakeXhr.instances[2].emitUploadDone();
      FakeXhr.instances[2].emitResponse(200);
    });
    await act(async () => {
      expect(await retryFailed).toBe(true);
    });
  });

  it('refuses cancellation synchronously once upload finalization starts', async () => {
    const { result } = renderHook(() =>
      useDocumentUpload({ organizationId: 'org-1' }),
    );
    act(() => result.current.stageFiles([makeFile('finalizing.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));

    let cancelled = true;
    act(() => {
      FakeXhr.instances[0].emitUploadDone();
      cancelled = result.current.cancelUpload();
    });

    expect(cancelled).toBe(false);
    expect(FakeXhr.instances[0].aborted).toBe(false);
    await waitFor(() =>
      expect(result.current.trackedFiles[0]?.status).toBe('finalizing'),
    );
    expect(result.current.canCancelUpload).toBe(false);

    act(() => FakeXhr.instances[0].emitResponse(200));
    await act(async () => {
      expect((await upload).success).toBe(true);
    });
  });

  it('keeps cancellation disabled while document binding is pending', async () => {
    let resolveBinding!: () => void;
    mocks.createDocumentFromUpload.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBinding = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useDocumentUpload({ organizationId: 'org-1' }),
    );
    act(() => result.current.stageFiles([makeFile('binding.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => {
      FakeXhr.instances[0].emitUploadDone();
      FakeXhr.instances[0].emitResponse(200);
    });

    await waitFor(() =>
      expect(result.current.trackedFiles[0]?.status).toBe('binding'),
    );
    expect(result.current.cancelUpload()).toBe(false);
    expect(result.current.canCancelUpload).toBe(false);
    expect(FakeXhr.instances[0].aborted).toBe(false);

    act(() => resolveBinding());
    await act(async () => {
      expect((await upload).success).toBe(true);
    });
  });

  it('uses the intent protocol in order for a Convex POST replacement', async () => {
    const onSuccess = vi.fn();
    mocks.beginControlledDocumentReplacementUpload.mockImplementationOnce(
      async () => {
        protocolEvents.push('begin');
        return {
          intentId: 'intent-convex',
          url: 'https://replacement.test/convex',
          method: 'POST',
          uploadContentType:
            'application/pdf; tale-intent=nonce-for-this-upload',
          uploadExpiresAt: Date.now() + 60_000,
        };
      },
    );
    mocks.registerControlledDocumentReplacementUpload.mockImplementationOnce(
      async () => {
        protocolEvents.push('register');
        return null;
      },
    );
    mocks.finalizeControlledDocumentReplacementUpload.mockImplementationOnce(
      async () => {
        protocolEvents.push('finalize');
        return { version: 6 };
      },
    );
    const { result } = renderHook(() =>
      useDocumentUpload({
        organizationId: 'org-1',
        replacementTarget: {
          documentId: 'doc-1',
          expectedRecordState: 'approved',
          expectedVersion: 5,
          expectedFileId: 'storage-current',
        },
        onSuccess,
      }),
    );
    const file = makeFile('procedure.pdf');
    act(() => result.current.stageFiles([file]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://replacement.test/convex');
    expect(xhr.requestHeaders.get('Content-Type')).toBe(
      'application/pdf; tale-intent=nonce-for-this-upload',
    );
    expect(xhr.sentBody).toBe(file);

    act(() => {
      xhr.emitUploadDone();
      xhr.emitResponse(200, JSON.stringify({ storageId: 'storage-new' }));
    });
    await act(async () => {
      expect((await upload).success).toBe(true);
    });

    expect(protocolEvents).toEqual(['begin', 'upload', 'register', 'finalize']);
    expect(mocks.beginControlledDocumentReplacementUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        documentId: 'doc-1',
        expectedRecordState: 'approved',
        expectedVersion: 5,
        expectedFileId: 'storage-current',
        fileName: 'procedure.pdf',
        contentType: 'application/pdf',
      }),
    );
    expect(
      mocks.registerControlledDocumentReplacementUpload,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      intentId: 'intent-convex',
      storageId: 'storage-new',
    });
    expect(
      mocks.finalizeControlledDocumentReplacementUpload,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      intentId: 'intent-convex',
      storageId: 'storage-new',
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ version: 6 }),
    );
    expect(mocks.generateBlobUpload).not.toHaveBeenCalled();
    expect(mocks.deleteRejectedUploadBlob).not.toHaveBeenCalled();
  });

  it('uses begin, upload, and finalize in order for an S3 replacement', async () => {
    mocks.beginControlledDocumentReplacementUpload.mockImplementationOnce(
      async () => {
        protocolEvents.push('begin');
        return {
          intentId: 'intent-s3',
          url: 'https://replacement.test/s3',
          method: 'PUT',
          uploadContentType: 'application/pdf',
          uploadExpiresAt: Date.now() + 60_000,
        };
      },
    );
    mocks.finalizeControlledDocumentReplacementUpload.mockImplementationOnce(
      async () => {
        protocolEvents.push('finalize');
        return { version: 3 };
      },
    );
    const { result } = renderHook(() =>
      useDocumentUpload({
        organizationId: 'org-1',
        replacementTarget: {
          documentId: 'doc-1',
          expectedRecordState: 'draft',
          expectedVersion: 3,
          expectedFileId: 's3:org/current.pdf',
        },
      }),
    );
    act(() => result.current.stageFiles([makeFile('procedure.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => {
      FakeXhr.instances[0].emitUploadDone();
      FakeXhr.instances[0].emitResponse(200);
    });
    await act(async () => {
      expect((await upload).success).toBe(true);
    });

    expect(protocolEvents).toEqual(['begin', 'upload', 'finalize']);
    expect(
      mocks.registerControlledDocumentReplacementUpload,
    ).not.toHaveBeenCalled();
    expect(
      mocks.finalizeControlledDocumentReplacementUpload,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      intentId: 'intent-s3',
      storageId: undefined,
    });
  });

  it('cancels only the intent owned by the aborted operation', async () => {
    const { result } = renderHook(() =>
      useDocumentUpload({
        organizationId: 'org-1',
        replacementTarget: {
          documentId: 'doc-1',
          expectedRecordState: 'draft',
          expectedVersion: 2,
          expectedFileId: 'storage-current',
        },
      }),
    );
    act(() => result.current.stageFiles([makeFile('procedure.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let firstUpload!: Promise<{ success: boolean }>;
    act(() => {
      firstUpload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => {
      expect(result.current.cancelUpload()).toBe(true);
    });
    await act(async () => {
      expect((await firstUpload).success).toBe(false);
    });
    expect(
      mocks.cancelControlledDocumentReplacementUpload,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      intentId: 'intent-1',
    });

    let retry!: Promise<{ success: boolean }>;
    act(() => {
      retry = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    act(() => {
      FakeXhr.instances[1].emitUploadDone();
      FakeXhr.instances[1].emitResponse(200);
    });
    await act(async () => {
      expect((await retry).success).toBe(true);
    });

    expect(
      mocks.cancelControlledDocumentReplacementUpload,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.finalizeControlledDocumentReplacementUpload,
    ).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'intent-2' }));
  });

  it('treats a reconcile-bound finalize timeout as authoritative success', async () => {
    const onSuccess = vi.fn();
    mocks.finalizeControlledDocumentReplacementUpload.mockRejectedValueOnce(
      new UploadTimeoutError(),
    );
    mocks.reconcileControlledDocumentReplacementUpload.mockResolvedValueOnce({
      state: 'bound',
      resultVersion: 11,
      cleanupPending: false,
      updatedAt: Date.now(),
    });
    const { result } = renderHook(() =>
      useDocumentUpload({
        organizationId: 'org-1',
        replacementTarget: {
          documentId: 'doc-1',
          expectedRecordState: 'approved',
          expectedVersion: 10,
          expectedFileId: 'storage-current',
        },
        onSuccess,
      }),
    );
    act(() => result.current.stageFiles([makeFile('procedure.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => {
      FakeXhr.instances[0].emitUploadDone();
      FakeXhr.instances[0].emitResponse(200);
    });
    await act(async () => {
      expect((await upload).success).toBe(true);
    });

    expect(
      mocks.reconcileControlledDocumentReplacementUpload,
    ).toHaveBeenCalledWith({
      organizationId: 'org-1',
      intentId: 'intent-1',
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ version: 11 }),
    );
    expect(mocks.deleteRejectedUploadBlob).not.toHaveBeenCalled();
    expect(
      mocks.cancelControlledDocumentReplacementUpload,
    ).not.toHaveBeenCalled();
  });

  it('leaves a non-bound finalize timeout to intent-owned cleanup', async () => {
    mocks.finalizeControlledDocumentReplacementUpload.mockRejectedValueOnce(
      new UploadTimeoutError(),
    );
    mocks.reconcileControlledDocumentReplacementUpload.mockResolvedValueOnce({
      state: 'attesting',
      cleanupPending: true,
      updatedAt: Date.now(),
    });
    const { result } = renderHook(() =>
      useDocumentUpload({
        organizationId: 'org-1',
        replacementTarget: {
          documentId: 'doc-1',
          expectedRecordState: 'draft',
          expectedVersion: 2,
          expectedFileId: 'storage-current',
        },
      }),
    );
    act(() => result.current.stageFiles([makeFile('procedure.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => {
      FakeXhr.instances[0].emitUploadDone();
      FakeXhr.instances[0].emitResponse(200);
    });
    await act(async () => {
      expect((await upload).success).toBe(false);
    });

    await waitFor(() =>
      expect(result.current.trackedFiles[0]).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'record.replace.finalizePending',
          retryable: false,
        }),
      ),
    );
    expect(mocks.deleteRejectedUploadBlob).not.toHaveBeenCalled();
    expect(
      mocks.cancelControlledDocumentReplacementUpload,
    ).not.toHaveBeenCalled();
  });

  it('never generically deletes an intent-owned blob after finalize rejects it', async () => {
    mocks.finalizeControlledDocumentReplacementUpload.mockRejectedValueOnce(
      new BackendError({ code: 'UPLOAD_MIME_MISMATCH' }),
    );
    const { result } = renderHook(() =>
      useDocumentUpload({
        organizationId: 'org-1',
        replacementTarget: {
          documentId: 'doc-1',
          expectedRecordState: 'draft',
          expectedVersion: 2,
          expectedFileId: 'storage-current',
        },
      }),
    );
    act(() => result.current.stageFiles([makeFile('procedure.pdf')]));
    await waitFor(() => expect(result.current.trackedFiles).toHaveLength(1));

    let upload!: Promise<{ success: boolean }>;
    act(() => {
      upload = result.current.uploadFiles();
    });
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => {
      FakeXhr.instances[0].emitUploadDone();
      FakeXhr.instances[0].emitResponse(200);
    });
    await act(async () => {
      expect((await upload).success).toBe(false);
    });

    await waitFor(() =>
      expect(result.current.trackedFiles[0]).toEqual(
        expect.objectContaining({
          status: 'failed',
          error: 'record.replace.contentMismatch',
          retryable: false,
        }),
      ),
    );
    expect(mocks.deleteRejectedUploadBlob).not.toHaveBeenCalled();
  });
});
