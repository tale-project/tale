import { expect, test } from 'bun:test';

import {
  nativeObservationFailure,
  ObservationCleanupError,
  ObservationPhaseError,
  observationPhases,
} from './observation-errors';

test('nested refusal accepts only an exact authored envelope', () => {
  const envelope = {
    ok: false,
    command: 'tale',
    error: new ObservationPhaseError('nativeRetained').info,
  };
  expect(nativeObservationFailure(envelope)).toBeInstanceOf(
    ObservationPhaseError,
  );
  for (const value of [
    { ...envelope, ok: true },
    { ...envelope, command: 'deploy observe-native' },
    { ...envelope, error: { ...envelope.error, code: 1 } },
    { ...envelope, error: { ...envelope.error, cause: 'synthetic-secret' } },
    {
      ...envelope,
      error: {
        ...envelope.error,
        summary: envelope.error.summary + ' synthetic-secret',
      },
    },
    { ...envelope, extra: 'synthetic-secret' },
    null,
  ])
    expect(nativeObservationFailure(value)).toBeUndefined();
});

test('cleanup remains dominant over phase classification and has no private cause', async () => {
  for (const scope of ['session', 'tooling'] as const) {
    const failure = new ObservationCleanupError(scope);
    const caught = await observationPhases('native', async () => {
      throw failure;
    }).catch((error: unknown) => error);
    expect(caught).toBe(failure);
    expect(failure.info.cause).toBeUndefined();
  }
  expect(
    nativeObservationFailure({
      ok: false,
      command: 'tale',
      error: new ObservationCleanupError('session').info,
    }),
  ).toBeInstanceOf(ObservationCleanupError);
});
