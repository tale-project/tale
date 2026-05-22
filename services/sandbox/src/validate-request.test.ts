// Runtime validation covers every field downstream code trusts. The
// spawner side previously did `as ExecuteRequest` and would crash deep
// inside `spawn.ts` / `docker-args.ts` on a malformed input.

import { describe, expect, test } from 'bun:test';

import { validateExecuteRequest } from './validate-request.ts';

const good = {
  executionId: 'abc-123',
  organizationId: 'org_42',
  language: 'python',
  files: [{ path: 'main.py', content: 'print("hi")' }],
  entryPath: 'main.py',
};

describe('validateExecuteRequest', () => {
  test('accepts a minimal valid body', () => {
    const r = validateExecuteRequest(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.executionId).toBe('abc-123');
      expect(r.request.language).toBe('python');
      expect(r.request.entryPath).toBe('main.py');
      expect(r.request.files).toEqual([
        { path: 'main.py', content: 'print("hi")' },
      ]);
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

  // ----- mutex (entryPath xor steps) -----

  test('rejects request with both entryPath and steps (mutex)', () => {
    const r = validateExecuteRequest({
      ...good,
      steps: ['main.py'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly one/);
  });

  test('rejects request with neither entryPath nor steps', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      files: [{ path: 'main.py', content: 'x' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly one/);
  });

  // ----- single-script (`entryPath`) mode -----

  test('rejects single-script mode without files[]', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      entryPath: 'main.py',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/files\[\]/);
  });

  test('rejects entryPath that has no matching files[] entry', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      entryPath: 'missing.py',
      files: [{ path: 'main.py', content: 'print(1)' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must reference a path in files/);
  });

  test('rejects entryPath whose file is empty', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      entryPath: 'main.py',
      files: [{ path: 'main.py', content: '' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  test('rejects non-string entryPath', () => {
    const r = validateExecuteRequest({
      ...good,
      entryPath: 42,
    });
    expect(r.ok).toBe(false);
  });

  // ----- multi-step (`steps`) mode -----

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
      expect(r.request.entryPath).toBeUndefined();
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
    if (!r.ok) expect(r.error).toMatch(/files\[\]/);
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

  test('accepts steps including main.py — the leaky-abstraction regression gate', () => {
    // The user's literal trigger workflow: generator named main.py, validator
    // named test.py, both run in sequence. Before the reservation removal this
    // case errored out at the validator with "reserved entrypoint filename".
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: ['main.py', 'test.py'],
      files: [
        { path: 'main.py', content: 'print("gen")' },
        { path: 'test.py', content: 'print("validate")' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.steps).toEqual(['main.py', 'test.py']);
    }
  });

  test('accepts a node multi-step request with main.js', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'node',
      steps: ['main.js'],
      files: [{ path: 'main.js', content: 'console.log(1)' }],
    });
    expect(r.ok).toBe(true);
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
