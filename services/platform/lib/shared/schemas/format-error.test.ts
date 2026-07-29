import { describe, expect, it } from 'vitest';

import {
  formatZodError,
  formatZodErrorFull,
  zodErrorMessage,
} from './format-error';
import { piiConfigSchema } from './pii';
import { skillFrontmatterSchema } from './skills';

/** No raw zod/v4 issue-array JSON dump — the failure mode this module exists
 *  to prevent (`error.message` on a ZodError renders as `[{"expected":...`). */
function expectNoRawDump(message: string): void {
  expect(message).not.toMatch(/\[\s*\{\s*"expected"/);
  expect(message).not.toMatch(/"code"\s*:\s*"invalid_type"/);
}

describe('formatZodError', () => {
  it('names the field path and a human phrase for a bad pii config', () => {
    // Missing every required field (enabled, mode, enabledPatterns).
    const result = piiConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodError(result.error);
    expect(message).toContain('enabled');
    expect(message.length).toBeGreaterThan(0);
    expectNoRawDump(message);
  });

  it('names a nested array path for a bad custom pattern', () => {
    // Deep path: customPatterns[0].replacement missing + refinement failure.
    const result = piiConfigSchema.safeParse({
      enabled: true,
      mode: 'mask',
      enabledPatterns: [],
      customPatterns: [{ name: 'x', regex: '(' }],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodError(result.error);
    expect(message).toContain('customPatterns');
    expectNoRawDump(message);
  });

  it('names the field path and a human phrase for a bad skill frontmatter', () => {
    // `description` is required and missing.
    const result = skillFrontmatterSchema.safeParse({ name: 'a-skill' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodError(result.error);
    expect(message).toContain('description');
    expectNoRawDump(message);
  });

  it('truncates past maxIssues with a "(+N more)" tail', () => {
    const result = piiConfigSchema.safeParse({
      enabled: 'yes', // wrong type
      mode: 'shred', // not in enum
      enabledPatterns: 'email', // wrong type
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.length).toBeGreaterThan(1);

    const message = formatZodError(result.error, { maxIssues: 1 });
    expect(message).toMatch(/\(\+\d+ more\)$/);
  });
});

describe('formatZodErrorFull', () => {
  it('renders every issue (zod/v4 prettifyError), never the raw dump', () => {
    const result = piiConfigSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodErrorFull(result.error);
    expectNoRawDump(message);
    expect(message.length).toBeGreaterThan(0);
  });
});

describe('zodErrorMessage', () => {
  it('prefixes the formatted summary with the given label', () => {
    const result = piiConfigSchema.safeParse({
      enabled: true,
      mode: 'redact',
      enabledPatterns: [],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = zodErrorMessage('Invalid pii config', result.error);
    expect(message.startsWith('Invalid pii config: ')).toBe(true);
    expectNoRawDump(message);
  });
});
