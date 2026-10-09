import { expect, test } from 'bun:test';

import { ObservationCleanupError } from '../../lib/deployment/observation-errors';
import { CliError } from '../../utils/fail';
import { observationBoundary, observationInput } from './observe';

async function* input(value: string) {
  yield Buffer.from(value);
}
test.each([
  '{"secret":"synthetic-private-value"',
  '{"value":"' + 'x'.repeat(65536) + '"}',
])(
  'private ingress refuses malformed or oversized input without echo',
  async (value) => {
    const failure = await observationInput(input(value)).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CliError);
    expect(String(failure)).not.toContain('synthetic-private-value');
    expect(String(failure).length).toBeLessThan(128);
  },
);
test('boundary hides unknown and imported CLI payloads and never attaches a cause', async () => {
  for (const failure of [
    Error('synthetic-secret'),
    new CliError({
      summary: 'synthetic-secret',
      cause: Error('synthetic-secret'),
    }),
  ]) {
    const caught = await observationBoundary(async () => {
      throw failure;
    }).catch((error: CliError) => error);
    expect(caught).toBeInstanceOf(CliError);
    expect(JSON.stringify(caught)).not.toContain('synthetic-secret');
    expect(caught.info.cause).toBeUndefined();
    expect(caught.info.code).toBe(3);
  }
});

test('authored cleanup failures remain actionable without a private cause', async () => {
  const failure = new ObservationCleanupError('tooling');
  const caught = await observationBoundary(async () => {
    throw failure;
  }).catch((error: unknown) => error);
  expect(caught).toBe(failure);
  expect(failure.info.cause).toBeUndefined();
  expect(failure.info.summary).toContain(
    'tooling cleanup could not be verified',
  );
});

test('an incomplete private input stream times out without exposing its bytes', async () => {
  async function* stalled() {
    yield Buffer.from('{"synthetic-private-value":');
    await new Promise(() => {});
  }
  await expect(observationInput(stalled(), 5)).rejects.toThrow('timed out');
});
