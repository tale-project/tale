import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import { classifyTranscriptionError } from './classify_transcription_error';

describe('classifyTranscriptionError', () => {
  it('treats a missing transcription model as permanent', () => {
    expect(
      classifyTranscriptionError(
        new AppError({
          code: 'NO_TRANSCRIPTION_MODEL',
          message:
            'No transcription model is configured for this organization.',
        }),
      ),
    ).toEqual({ shouldRetry: false, reason: 'no_transcription_model' });
  });

  it('marks auth and bad-request statuses as permanent', () => {
    const auth: Error & { status?: number } = new Error('401');
    auth.status = 401;
    expect(classifyTranscriptionError(auth)).toEqual({
      shouldRetry: false,
      reason: 'auth_error',
    });

    const bad: Error & { status?: number } = new Error('bad');
    bad.status = 400;
    expect(classifyTranscriptionError(bad)).toEqual({
      shouldRetry: false,
      reason: 'bad_request',
    });
  });

  it('retries rate limits, 5xx, and network failures', () => {
    const rate: Error & { status?: number } = new Error('slow down');
    rate.status = 429;
    expect(classifyTranscriptionError(rate).shouldRetry).toBe(true);

    const server: Error & { status?: number } = new Error('boom');
    server.status = 503;
    expect(classifyTranscriptionError(server)).toEqual({
      shouldRetry: true,
      reason: 'server_error',
    });

    expect(classifyTranscriptionError(new Error('fetch failed'))).toMatchObject(
      { shouldRetry: true, reason: 'network_error' },
    );
  });
});
