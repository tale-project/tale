import { describe, expect, it } from 'vitest';

import { validateSandboxStep } from './sandbox';

describe('validateSandboxStep', () => {
  it('accepts a valid agent run with a bounded budget', () => {
    const res = validateSandboxStep({
      run: {
        agent: 'implementer',
        budget: { maxCents: 200, maxWallClockMs: 600000 },
      },
    });
    expect(res.valid).toBe(true);
  });

  it('accepts a valid script run', () => {
    const res = validateSandboxStep({
      run: { script: 'pack://issue-desk/verify.py', language: 'python' },
    });
    expect(res.valid).toBe(true);
  });

  it('rejects when neither agent nor script is given', () => {
    const res = validateSandboxStep({ run: {} });
    expect(res.valid).toBe(false);
  });

  it('rejects when BOTH agent and script are given', () => {
    const res = validateSandboxStep({
      run: { agent: 'x', script: 'y', language: 'bash' },
    });
    expect(res.valid).toBe(false);
  });

  it('requires a bounded budget for agent runs', () => {
    const res = validateSandboxStep({ run: { agent: 'x' } });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('budget'))).toBe(true);
  });

  it('requires a known language for script runs', () => {
    const res = validateSandboxStep({
      run: { script: 's', language: 'rust' },
    });
    expect(res.valid).toBe(false);
  });

  it('rejects an input without exactly one source', () => {
    const res = validateSandboxStep({
      run: { script: 's', language: 'bash' },
      inputs: [{ as: '/user/in.txt', from: { fileId: 'f', content: 'c' } }],
    });
    expect(res.valid).toBe(false);
  });

  it('accepts a well-formed input', () => {
    const res = validateSandboxStep({
      run: { script: 's', language: 'bash' },
      inputs: [{ as: '/user/in.txt', from: { fileId: 'f1' } }],
    });
    expect(res.valid).toBe(true);
  });

  it('errors when run is missing', () => {
    const res = validateSandboxStep({});
    expect(res.valid).toBe(false);
  });
});
