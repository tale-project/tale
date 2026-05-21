// Runtime validation covers every field downstream code trusts. The
// spawner side previously did `as ExecuteRequest` and would crash deep
// inside `spawn.ts` / `docker-args.ts` on a malformed input.

import { describe, expect, test } from 'bun:test';

import { validateExecuteRequest } from './validate-request.ts';

const good = {
  executionId: 'abc-123',
  organizationId: 'org_42',
  language: 'python',
  code: 'print("hi")',
};

describe('validateExecuteRequest', () => {
  test('accepts a minimal valid body', () => {
    const r = validateExecuteRequest(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.executionId).toBe('abc-123');
      expect(r.request.language).toBe('python');
    }
  });

  test('rejects null / non-object', () => {
    expect(validateExecuteRequest(null).ok).toBe(false);
    expect(validateExecuteRequest('hello').ok).toBe(false);
    expect(validateExecuteRequest([1, 2, 3]).ok).toBe(false);
  });

  test('rejects bad executionId alphabet', () => {
    const r = validateExecuteRequest({ ...good, executionId: 'abc;rm -rf' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/executionId/);
  });

  test('rejects bad organizationId alphabet', () => {
    const r = validateExecuteRequest({ ...good, organizationId: 'a b' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/organizationId/);
  });

  test('rejects unknown language', () => {
    const r = validateExecuteRequest({ ...good, language: 'ruby' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/language/);
  });

  test('rejects non-string code', () => {
    const r = validateExecuteRequest({ ...good, code: 42 });
    expect(r.ok).toBe(false);
  });

  test('rejects oversized code', () => {
    const r = validateExecuteRequest({
      ...good,
      code: 'x'.repeat(300_000),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/code/);
  });

  test('rejects non-array packages', () => {
    const r = validateExecuteRequest({ ...good, packages: 'numpy' });
    expect(r.ok).toBe(false);
  });

  test('rejects packages with > 20 entries', () => {
    const r = validateExecuteRequest({
      ...good,
      packages: Array.from({ length: 21 }, (_, i) => `pkg-${i}`),
    });
    expect(r.ok).toBe(false);
  });

  test('rejects oversized package spec', () => {
    const r = validateExecuteRequest({
      ...good,
      packages: ['x'.repeat(500)],
    });
    expect(r.ok).toBe(false);
  });

  test('rejects negative timeoutMs', () => {
    const r = validateExecuteRequest({ ...good, timeoutMs: -1 });
    expect(r.ok).toBe(false);
  });

  test('rejects out-of-range timeoutMs', () => {
    const r = validateExecuteRequest({ ...good, timeoutMs: 1_000_000_000 });
    expect(r.ok).toBe(false);
  });

  test('rejects non-numeric timeoutMs (regression: previous "as" cast let strings through)', () => {
    const r = validateExecuteRequest({ ...good, timeoutMs: '30000' });
    expect(r.ok).toBe(false);
  });

  test('rejects non-boolean options.allowSdist', () => {
    const r = validateExecuteRequest({
      ...good,
      options: { allowSdist: 'yes' },
    });
    expect(r.ok).toBe(false);
  });

  test('accepts options shape with both flags', () => {
    const r = validateExecuteRequest({
      ...good,
      options: { allowSdist: true, allowInstallScripts: false },
    });
    expect(r.ok).toBe(true);
  });

  test('preserves only known fields (drops unrecognized keys)', () => {
    const r = validateExecuteRequest({
      ...good,
      unknownField: 'should-not-survive',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request).not.toHaveProperty('unknownField');
    }
  });

  // ----- multi-step (`steps`) mode -----

  test('rejects request with both code and steps (mutex)', () => {
    const r = validateExecuteRequest({
      ...good,
      steps: ['gen.py'],
      files: [{ path: 'gen.py', content: 'print("gen")' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly one/);
  });

  test('rejects request with neither code nor steps', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly one/);
  });

  test('accepts a valid multi-step request', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: ['gen.py', 'validate.py'],
      files: [
        { path: 'gen.py', content: 'print("gen")' },
        { path: 'validate.py', content: 'print("validate")' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.steps).toEqual(['gen.py', 'validate.py']);
      expect(r.request.code).toBeUndefined();
    }
  });

  test('rejects empty steps array', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: [],
      files: [{ path: 'gen.py', content: 'x' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one/);
  });

  test('rejects steps without files[]', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: ['gen.py'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/requires `files\[\]`/);
  });

  test('rejects step path not present in files[]', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: ['missing.py'],
      files: [{ path: 'gen.py', content: 'x' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must reference a path in files/);
  });

  test('rejects step path that is the reserved entrypoint filename', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: ['main.py'],
      files: [{ path: 'main.py', content: 'print(1)' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reserved entrypoint/);
  });

  test('rejects steps with > MAX_STEPS_PER_REQUEST entries', () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      path: `s${i}.py`,
      content: 'x',
    }));
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: files.map((f) => f.path),
      files,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exceeds .* limit/);
  });
});
