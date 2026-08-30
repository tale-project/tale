import { describe, expect, it } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';

import { retryAdaptedRead, runAdapted, toBackendError } from './adapters';
import { BackendApiError } from './api-client';

describe('toBackendError', () => {
  it('turns a deterministic 4xx into a BackendError carrying code + data', () => {
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
    expect(normalized).toBeInstanceOf(BackendError);
    if (!(normalized instanceof BackendError)) return;
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
    ).rejects.toBeInstanceOf(BackendError);
  });
});

describe('retryAdaptedRead', () => {
  it('never retries a deterministic answer, retries transport 3x', () => {
    expect(retryAdaptedRead(0, new BackendError({ code: 'X' }))).toBe(false);
    expect(retryAdaptedRead(0, new BackendApiError(404, 'nope'))).toBe(false);
    expect(retryAdaptedRead(0, new BackendApiError(503, 'later'))).toBe(true);
    expect(retryAdaptedRead(2, new Error('network'))).toBe(true);
    expect(retryAdaptedRead(3, new Error('network'))).toBe(false);
  });
});
