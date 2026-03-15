import { describe, it, expect } from 'vitest';

import { validateOutputStep } from './output';

describe('validateOutputStep', () => {
  it('passes with no mapping', () => {
    const result = validateOutputStep({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes with valid mapping', () => {
    const result = validateOutputStep({
      mapping: {
        analysis: '{{steps.analyze.output.data}}',
        customerId: '{{customerId}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes with empty mapping', () => {
    const result = validateOutputStep({ mapping: {} });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when mapping is not an object', () => {
    const result = validateOutputStep({ mapping: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must be an object'))).toBe(
      true,
    );
  });

  it('fails when mapping value is not a string', () => {
    const result = validateOutputStep({
      mapping: { key: 123 },
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('must be a non-empty string')),
    ).toBe(true);
  });

  it('fails when mapping value is empty string', () => {
    const result = validateOutputStep({
      mapping: { key: '  ' },
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('must be a non-empty string')),
    ).toBe(true);
  });

  it('warns when mapping references secrets', () => {
    const result = validateOutputStep({
      mapping: {
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
    const result = validateOutputStep({
      mapping: {
        token: '{{ secrets.apiKey }}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('does not warn for non-secret references', () => {
    const result = validateOutputStep({
      mapping: {
        data: '{{steps.fetch.output.data}}',
        id: '{{entityId}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  // Backward compatibility with legacy "outputMapping" field
  it('accepts legacy outputMapping with deprecation warning', () => {
    const result = validateOutputStep({
      outputMapping: {
        analysis: '{{steps.analyze.output.data}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('deprecated'))).toBe(true);
  });

  it('prefers mapping over outputMapping when both present', () => {
    const result = validateOutputStep({
      mapping: {
        analysis: '{{steps.analyze.output.data}}',
      },
      outputMapping: {
        old: '{{steps.old.output.data}}',
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('deprecated'))).toBe(false);
  });
});
