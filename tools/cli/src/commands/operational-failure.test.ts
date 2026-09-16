import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  ConfigError,
  ExternalToolError,
  NativeRequestError,
} from '../lib/config/releases/model';
import { CliError, ExitCode, usageError } from '../utils/fail';
import { NonInteractiveError } from '../utils/prompt';
import { operationalFailure } from './operational-failure';

const fallback = {
  schema: 'Input does not match its schema.',
  summary: 'Operation failed.',
  next: 'Check the inputs.',
};

function rendered(error: unknown) {
  const failure = operationalFailure(error, fallback);
  if (!(failure instanceof CliError)) throw new Error('not a CLI error');
  return failure.info;
}

// Every configuration and deployment command renders failures through this
// one rule. The deploy wrapper once kept a stricter copy that replaced even
// authored errors with a fixed line, so a pack its CLI could not read failed a
// 38-minute prepare with no cause.
describe('operationalFailure', () => {
  test('an authored configuration error keeps its words', () => {
    expect(
      rendered(
        new ConfigError('source capsule client differs from declaration'),
      ),
    ).toEqual({
      summary: 'source capsule client differs from declaration',
      next: undefined,
      code: ExitCode.Precondition,
    });
  });

  test('a native or external tool failure is an external dependency', () => {
    for (const error of [
      new NativeRequestError('Tale returned invalid or oversized JSON'),
      new ExternalToolError('Git is required on PATH.'),
    ]) {
      expect(rendered(error)).toMatchObject({
        summary: error.message,
        code: ExitCode.ExternalDep,
      });
    }
  });

  test('schema drift names the input, not its values', () => {
    const parsed = z.object({ token: z.number() }).safeParse({ token: 'x' });
    if (parsed.success) throw new Error('the schema accepted a string');
    expect(rendered(parsed.error)).toMatchObject({
      summary: fallback.schema,
      code: ExitCode.Precondition,
    });
  });

  test('an unexpected error never reaches the log', () => {
    const info = rendered(
      new Error('fetch failed: https://user:secret-token@example.invalid'),
    );
    expect(info).toEqual({
      summary: fallback.summary,
      next: fallback.next,
      code: ExitCode.Precondition,
    });
    expect(JSON.stringify(info)).not.toContain('secret-token');
  });

  test('a CLI error or an unconfirmed prompt passes through unchanged', () => {
    const usage = usageError('--bundle is required.');
    expect(operationalFailure(usage, fallback)).toBe(usage);
    const unconfirmed = new NonInteractiveError(
      'Deployment was not confirmed.',
    );
    expect(operationalFailure(unconfirmed, fallback)).toBe(unconfirmed);
  });
});
