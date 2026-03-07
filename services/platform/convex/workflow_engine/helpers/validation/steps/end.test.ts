import { describe, it, expect } from 'vitest';

import { validateEndStep } from './end';

describe('validateEndStep', () => {
  it('passes with no outputMapping', () => {
    const result = validateEndStep({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes with valid outputMapping', () => {
    const result = validateEndStep({
      outputMapping: {
        analysis: '{{steps.analyze.output.data}}',
        customerId: '{{customerId}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes with empty outputMapping', () => {
    const result = validateEndStep({ outputMapping: {} });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when outputMapping is not an object', () => {
    const result = validateEndStep({ outputMapping: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be an object'))).toBe(
      true,
    );
  });

  it('fails when outputMapping value is not a string', () => {
    const result = validateEndStep({
      outputMapping: { key: 123 },
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('must be a non-empty string')),
    ).toBe(true);
  });

  it('fails when outputMapping value is empty string', () => {
    const result = validateEndStep({
      outputMapping: { key: '  ' },
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('must be a non-empty string')),
    ).toBe(true);
  });

  it('warns when outputMapping references secrets', () => {
    const result = validateEndStep({
      outputMapping: {
        token: '{{secrets.apiKey}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('references secrets'))).toBe(
      true,
    );
  });

  it('warns with spaces in secrets template', () => {
    const result = validateEndStep({
      outputMapping: {
        token: '{{ secrets.apiKey }}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('does not warn for non-secret references', () => {
    const result = validateEndStep({
      outputMapping: {
        data: '{{steps.fetch.output.data}}',
        id: '{{entityId}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
