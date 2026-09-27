import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import {
  backendErrorFromResponse,
  backendRefusalDetail,
  isBackendRefusal,
  projectAdaptedRead,
  retryAdaptedRead,
  runAdapted,
  toBackendError,
} from './adapters';
import { BackendApiError } from './api-client';

describe('toBackendError', () => {
  it('turns a deterministic 4xx into a AppError carrying code + data', () => {
    const normalized = toBackendError(
      new BackendApiError(
        400,
        'Automations are bound to this project',
        'PROJECT_HAS_BOUND_AUTOMATIONS',
        {
          automations: ['weekly-report'],
        },
      ),
    );
    expect(normalized).toBeInstanceOf(AppError);
    if (!(normalized instanceof AppError)) return;
    expect(normalized.data).toEqual({
      code: 'PROJECT_HAS_BOUND_AUTOMATIONS',
      automations: ['weekly-report'],
      message: 'Automations are bound to this project',
    });
  });

  it('leaves transport-ish failures untouched (5xx, plain errors)', () => {
    const gateway = new BackendApiError(502, 'Bad gateway');
    expect(toBackendError(gateway)).toBe(gateway);
    const plain = new Error('socket hang up');
    expect(toBackendError(plain)).toBe(plain);
  });
});

describe('runAdapted', () => {
  it('passes results through and normalizes thrown 4xx', async () => {
    await expect(runAdapted(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(
      runAdapted(() =>
        Promise.reject(
          new BackendApiError(403, 'No project access', 'PROJECT_FORBIDDEN'),
        ),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('isBackendRefusal', () => {
  it('is a 4xx answer or the AppError one becomes, never a fault', () => {
    expect(isBackendRefusal(new BackendApiError(409, 'taken'))).toBe(true);
    expect(
      isBackendRefusal(toBackendError(new BackendApiError(403, 'no', 'X'))),
    ).toBe(true);
    // A 5xx stays a fault even when its body carried structured data.
    expect(
      isBackendRefusal(new BackendApiError(503, 'later', 'X', { a: 1 })),
    ).toBe(false);
    expect(isBackendRefusal(new TypeError('Failed to fetch'))).toBe(false);
    expect(isBackendRefusal(undefined)).toBe(false);
  });
});

/**
 * An upload POST sends a file, not JSON, so it cannot go through
 * `backendFetch` — and it used to throw `upload failed: <status>`, keeping
 * nothing the door said. It now throws what an adapted call throws.
 */
describe('backendErrorFromResponse', () => {
  it("turns a refused upload into the AppError of the door's own words", async () => {
    const error = await backendErrorFromResponse(
      Response.json(
        {
          error: 'FILE_SIZE_INVALID',
          message: 'The file exceeds the 512 MiB limit',
        },
        { status: 413 },
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      data: {
        code: 'FILE_SIZE_INVALID',
        message: 'The file exceeds the 512 MiB limit',
      },
    });
  });

  it('keeps a 5xx a transient BackendApiError', async () => {
    const error = await backendErrorFromResponse(
      Response.json({ error: 'OBJECT_STORE_UNCONFIGURED' }, { status: 503 }),
    );
    expect(error).toBeInstanceOf(BackendApiError);
    expect(isBackendRefusal(error)).toBe(false);
  });
});

describe('backendRefusalDetail', () => {
  it("is the handler's sentence, else its bare code", () => {
    expect(
      backendRefusalDetail(
        new AppError({
          code: 'FILE_SIZE_INVALID',
          message: 'The file exceeds the 512 MiB limit',
        }),
      ),
    ).toBe('The file exceeds the 512 MiB limit');
    // The fetch boundary repeats a bare code as the message.
    expect(
      backendRefusalDetail(
        new AppError({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' }),
      ),
    ).toBe('RATE_LIMITED');
    expect(
      backendRefusalDetail(new AppError({ code: 'FOLDER_NAME_TAKEN' })),
    ).toBe('FOLDER_NAME_TAKEN');
  });

  it('reads a raw 4xx BackendApiError the same way', () => {
    expect(
      backendRefusalDetail(
        new BackendApiError(400, 'text: too long', 'invalid body'),
      ),
    ).toBe('text: too long');
    expect(
      backendRefusalDetail(
        new BackendApiError(404, 'thread not found', 'thread not found'),
      ),
    ).toBe('thread not found');
  });

  it('says nothing for a fault or for an answer without a code', () => {
    expect(
      backendRefusalDetail(
        new BackendApiError(
          503,
          'OBJECT_STORE_UNCONFIGURED',
          'OBJECT_STORE_UNCONFIGURED',
        ),
      ),
    ).toBeUndefined();
    // A proxy page: the status text is the client's, not the door's.
    expect(
      backendRefusalDetail(
        new BackendApiError(413, 'Request failed with status 413'),
      ),
    ).toBeUndefined();
    expect(
      backendRefusalDetail(new TypeError('Failed to fetch')),
    ).toBeUndefined();
    expect(backendRefusalDetail(undefined)).toBeUndefined();
  });
});

describe('retryAdaptedRead', () => {
  it('never retries a deterministic answer, retries transport 3x', () => {
    expect(retryAdaptedRead(0, new AppError({ code: 'X' }))).toBe(false);
    expect(retryAdaptedRead(0, new BackendApiError(404, 'nope'))).toBe(false);
    expect(retryAdaptedRead(0, new BackendApiError(503, 'later'))).toBe(true);
    expect(retryAdaptedRead(2, new Error('network'))).toBe(true);
    expect(retryAdaptedRead(3, new Error('network'))).toBe(false);
  });
});

describe('projectAdaptedRead', () => {
  it('hands the fetched body through as is when the row has no select', () => {
    expect(projectAdaptedRead({}, { open: 3 })).toEqual({ open: 3 });
  });

  it("applies the row's select, so a shared body never reaches a caller raw", () => {
    const select = (data: unknown) => (data as { open: number }).open;
    expect(projectAdaptedRead({ select }, { open: 3 })).toBe(3);
  });
});
