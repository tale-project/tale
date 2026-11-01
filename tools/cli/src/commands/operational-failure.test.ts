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

  test('schema drift names each field and what it expects, never its value', () => {
    const parsed = z
      .object({ token: z.number() })
      .safeParse({ token: 'secret-value' });
    if (parsed.success) throw new Error('the schema accepted a string');
    const info = rendered(parsed.error);
    expect(info).toEqual({
      summary:
        'Input does not match its schema. Mismatched fields: token (expected number).',
      code: ExitCode.Precondition,
    });
    expect(JSON.stringify(info)).not.toContain('secret-value');
  });

  test('a nested mismatch names its path, never a value or a message quoting one', () => {
    const parsed = z
      .strictObject({
        origin: z.url(),
        runtime: z.strictObject({
          revision: z.string().regex(/^[0-9a-f]{40}$/),
        }),
        configs: z.array(z.strictObject({ project: z.string().min(1) })),
        owner: z.string().superRefine((value, context) => {
          context.addIssue({ code: 'custom', message: `${value} is taken` });
        }),
      })
      .safeParse({
        origin: 'secret-value',
        runtime: { revision: 'secret-value', 'two words': 'secret-value' },
        configs: [{ project: 'core' }, { project: '' }],
        owner: 'secret-value',
      });
    if (parsed.success) throw new Error('the schema accepted the input');
    const info = rendered(parsed.error);
    expect(info.summary).toBe(
      'Input does not match its schema. Mismatched fields: origin (expected url), runtime.revision (does not match its pattern), runtime."two words" (unknown field), configs[1].project (expected string length >= 1), owner (invalid).',
    );
    expect(JSON.stringify(info)).not.toContain('secret-value');
  });

  test('a wide mismatch names five places once and counts the rest', () => {
    const parsed = z
      .object({
        a: z.string(),
        b: z.string(),
        c: z.string(),
        d: z.string(),
        e: z.string(),
        f: z.number().int().positive(),
        g: z
          .string()
          .refine(() => false)
          .refine(() => false),
      })
      .safeParse({ f: 0, g: '' });
    if (parsed.success) throw new Error('the schema accepted the input');
    expect(rendered(parsed.error).summary).toBe(
      'Input does not match its schema. Mismatched fields: a (expected string), b (expected string), c (expected string), d (expected string), e (expected string) and 2 more.',
    );
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
