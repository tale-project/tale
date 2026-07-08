import { describe, expect, it } from 'vitest';

import { agentJsonSchema } from './agents';
import {
  formatZodError,
  formatZodErrorFull,
  zodErrorMessage,
} from './format-error';
import { promptJsonSchema } from './prompts';
import { providerJsonSchema } from './providers';

/** No raw zod/v4 issue-array JSON dump — the failure mode this module exists
 *  to prevent (`error.message` on a ZodError renders as `[{"expected":...`). */
function expectNoRawDump(message: string): void {
  expect(message).not.toMatch(/\[\s*\{\s*"expected"/);
  expect(message).not.toMatch(/"code"\s*:\s*"invalid_type"/);
}

describe('formatZodError', () => {
  it('names the field path and a human phrase for a bad agent config', () => {
    // Missing every required field (displayName, systemInstructions/prompt
    // shape, supportedModels) — mirrors agents.test.ts's baseAgent, broken.
    const result = agentJsonSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodError(result.error);
    expect(message).toContain('displayName');
    expect(message.length).toBeGreaterThan(0);
    expectNoRawDump(message);
  });

  it('names the field path and a human phrase for a bad provider config', () => {
    // baseUrl is not a URL and models is missing — mirrors providers.test.ts's
    // baseProvider, broken.
    const result = providerJsonSchema.safeParse({
      displayName: 'Test Provider',
      baseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodError(result.error);
    expect(message).toContain('baseUrl');
    expectNoRawDump(message);
  });

  it('names the field path and a human phrase for a bad prompt config', () => {
    // `content` is required and missing.
    const result = promptJsonSchema.safeParse({ title: 'A prompt' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodError(result.error);
    expect(message).toContain('content');
    expectNoRawDump(message);
  });

  it('truncates past maxIssues with a "(+N more)" tail', () => {
    const result = agentJsonSchema.safeParse({
      displayName: 123, // wrong type
      systemInstructions: 456, // wrong type
      supportedModels: 'not-an-array', // wrong type
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
    const result = agentJsonSchema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = formatZodErrorFull(result.error);
    expectNoRawDump(message);
    expect(message.length).toBeGreaterThan(0);
  });
});

describe('zodErrorMessage', () => {
  it('prefixes the formatted summary with the given label', () => {
    const result = providerJsonSchema.safeParse({
      displayName: 'Test Provider',
      baseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    const message = zodErrorMessage('Invalid provider JSON', result.error);
    expect(message.startsWith('Invalid provider JSON: ')).toBe(true);
    expectNoRawDump(message);
  });
});
