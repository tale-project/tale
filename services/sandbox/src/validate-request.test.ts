// Runtime validation covers every field downstream code trusts. The
// spawner side previously did `as ExecuteRequest` and would crash deep
// inside `spawn.ts` / `docker-args.ts` on a malformed input.

import { describe, expect, test } from 'bun:test';

import { validateExecuteRequest } from './validate-request.ts';

// Minimal valid request shape. Each workspace file carries a URL the
// spawner GETs to fetch the bytes (no inline content) — see
// `services/sandbox/src/types.ts:SandboxFile`.
const FIXTURE_URL = 'http://proxy/api/storage/test-file';
const good = {
  executionId: 'abc-123',
  organizationId: 'org_42',
  language: 'python',
  files: [{ path: 'main.py', url: FIXTURE_URL }],
  entryPath: 'main.py',
  outputUploadSlots: [{ url: 'http://proxy/api/storage/upload?token=test' }],
  outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
  reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
};

describe('validateExecuteRequest', () => {
  test('accepts a minimal valid body', () => {
    const r = validateExecuteRequest(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.executionId).toBe('abc-123');
      expect(r.request.language).toBe('python');
      expect(r.request.entryPath).toBe('main.py');
      expect(r.request.files).toEqual([{ path: 'main.py', url: FIXTURE_URL }]);
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
      files: [{ path: 'main.py', url: FIXTURE_URL }],
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
      files: [{ path: 'main.py', url: FIXTURE_URL }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must reference a path in files/);
  });

  test('rejects non-string entryPath', () => {
    const r = validateExecuteRequest({
      ...good,
      entryPath: 42,
    });
    expect(r.ok).toBe(false);
  });

  // ----- files[] URL validation -----

  test('rejects files[].url that is not a string', () => {
    const r = validateExecuteRequest({
      ...good,
      files: [{ path: 'main.py', url: 123 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/files\[0\]\.url/);
  });

  test('rejects empty files[].url', () => {
    const r = validateExecuteRequest({
      ...good,
      files: [{ path: 'main.py', url: '' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-empty/);
  });

  test('rejects files[].url with non-http(s) scheme', () => {
    const r = validateExecuteRequest({
      ...good,
      files: [{ path: 'main.py', url: 'file:///etc/passwd' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/http:\/\/ or https:\/\//);
  });

  test('accepts https:// files[].url', () => {
    const r = validateExecuteRequest({
      ...good,
      files: [
        { path: 'main.py', url: 'https://proxy.example.com/api/storage/abc' },
      ],
    });
    expect(r.ok).toBe(true);
  });

  test('rejects files[] entry missing url', () => {
    const r = validateExecuteRequest({
      ...good,
      files: [{ path: 'main.py' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/files\[0\]\.url/);
  });

  // ----- multi-step (`steps`) mode -----

  test('accepts a valid multi-step request', () => {
    const r = validateExecuteRequest({
      executionId: 'abc-123',
      organizationId: 'org_42',
      language: 'python',
      steps: ['gen.py', 'validate.py'],
      files: [
        { path: 'gen.py', url: 'http://proxy/api/storage/gen' },
        { path: 'validate.py', url: 'http://proxy/api/storage/validate' },
      ],
      outputUploadSlots: [],
      outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
      reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
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
      files: [{ path: 'gen.py', url: FIXTURE_URL }],
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
      files: [{ path: 'gen.py', url: FIXTURE_URL }],
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
        { path: 'main.py', url: 'http://proxy/api/storage/main' },
        { path: 'test.py', url: 'http://proxy/api/storage/test' },
      ],
      outputUploadSlots: [],
      outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
      reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
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
      files: [{ path: 'main.js', url: FIXTURE_URL }],
      outputUploadSlots: [],
      outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
      reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
    });
    expect(r.ok).toBe(true);
  });

  test('rejects steps with > MAX_STEPS_PER_REQUEST entries', () => {
    const files = Array.from({ length: 11 }, (_, i) => ({
      path: `s${i}.py`,
      url: `http://proxy/api/storage/s${i}`,
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

  test('accepts polyglot multi-step with mixed .py + .js extensions', () => {
    const r = validateExecuteRequest({
      executionId: 'poly-1',
      organizationId: 'org_42',
      language: 'polyglot',
      steps: ['gen.js', 'qa.py'],
      files: [
        { path: 'gen.js', url: 'http://proxy/api/storage/gen' },
        { path: 'qa.py', url: 'http://proxy/api/storage/qa' },
      ],
      packagesByLang: {
        python: ['markitdown[pptx]==0.0.1a3'],
        node: ['pptxgenjs@3.12.0'],
      },
      outputUploadSlots: [],
      outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
      reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.language).toBe('polyglot');
      expect(r.request.steps).toEqual(['gen.js', 'qa.py']);
      expect(r.request.packagesByLang).toEqual({
        python: ['markitdown[pptx]==0.0.1a3'],
        node: ['pptxgenjs@3.12.0'],
      });
    }
  });

  test('rejects polyglot with a step using an unsupported extension', () => {
    const r = validateExecuteRequest({
      executionId: 'poly-2',
      organizationId: 'org_42',
      language: 'polyglot',
      steps: ['main.py', 'helper.rb'],
      files: [
        { path: 'main.py', url: 'http://proxy/api/storage/main' },
        { path: 'helper.rb', url: 'http://proxy/api/storage/helper' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported polyglot extension/);
  });

  test('rejects polyglot without steps (single-script mode is not allowed)', () => {
    const r = validateExecuteRequest({
      executionId: 'poly-3',
      organizationId: 'org_42',
      language: 'polyglot',
      entryPath: 'main.py',
      files: [{ path: 'main.py', url: FIXTURE_URL }],
      outputUploadSlots: [],
      outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
      reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/polyglot requires/);
  });

  test('passes through priorOutputDownloads when valid', () => {
    // Regression guard: the validator's request-output allowlist used to
    // silently drop `priorOutputFiles` (legacy field). Post-sandbox-
    // wobbly-origami this is `priorOutputDownloads` (URL list, no base64).
    const r = validateExecuteRequest({
      ...good,
      priorOutputDownloads: [
        { name: 'deck.pptx', url: 'http://proxy/api/storage/abc' },
        { name: 'nested/report.txt', url: 'http://proxy/api/storage/def' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.priorOutputDownloads).toEqual([
        { name: 'deck.pptx', url: 'http://proxy/api/storage/abc' },
        { name: 'nested/report.txt', url: 'http://proxy/api/storage/def' },
      ]);
    }
  });

  test('rejects non-array priorOutputDownloads', () => {
    const r = validateExecuteRequest({
      ...good,
      priorOutputDownloads: 'oops',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/priorOutputDownloads/);
  });

  test('rejects priorOutputDownloads entry with non-string fields', () => {
    const r = validateExecuteRequest({
      ...good,
      priorOutputDownloads: [{ name: 'x', url: 123 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/url/);
  });

  test('passes through userUploadDownloads when valid', () => {
    const r = validateExecuteRequest({
      ...good,
      userUploadDownloads: [
        { name: 'data.csv', url: 'http://proxy/api/storage/csv1' },
        { name: 'template.docx', url: 'http://proxy/api/storage/docx1' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.userUploadDownloads).toEqual([
        { name: 'data.csv', url: 'http://proxy/api/storage/csv1' },
        { name: 'template.docx', url: 'http://proxy/api/storage/docx1' },
      ]);
    }
  });

  test('rejects non-array userUploadDownloads', () => {
    const r = validateExecuteRequest({
      ...good,
      userUploadDownloads: 'oops',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/userUploadDownloads/);
  });

  test('rejects userUploadDownloads entry with non-string fields', () => {
    const r = validateExecuteRequest({
      ...good,
      userUploadDownloads: [{ name: 'x', url: 123 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/userUploadDownloads.*url/);
  });

  test('keeps priorOutputDownloads and userUploadDownloads independent', () => {
    // Both present at once → both pass through, neither contaminates the
    // other (catches a regression where the validator might write the same
    // local var to both fields).
    const r = validateExecuteRequest({
      ...good,
      priorOutputDownloads: [
        { name: 'old.pptx', url: 'http://proxy/api/storage/old' },
      ],
      userUploadDownloads: [
        { name: 'fresh.csv', url: 'http://proxy/api/storage/fresh' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.priorOutputDownloads).toEqual([
        { name: 'old.pptx', url: 'http://proxy/api/storage/old' },
      ]);
      expect(r.request.userUploadDownloads).toEqual([
        { name: 'fresh.csv', url: 'http://proxy/api/storage/fresh' },
      ]);
    }
  });

  test('rejects body missing outputUploadSlots', () => {
    const { outputUploadSlots: _, ...withoutSlots } = good;
    const r = validateExecuteRequest(withoutSlots);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outputUploadSlots/);
  });

  test('rejects body missing outputUrlEndpoint', () => {
    const { outputUrlEndpoint: _, ...withoutEndpoint } = good;
    const r = validateExecuteRequest(withoutEndpoint);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outputUrlEndpoint/);
  });

  test('rejects packagesByLang exceeding combined 20-spec cap', () => {
    const r = validateExecuteRequest({
      executionId: 'poly-4',
      organizationId: 'org_42',
      language: 'polyglot',
      steps: ['gen.js', 'qa.py'],
      files: [
        { path: 'gen.js', url: 'http://proxy/api/storage/gen' },
        { path: 'qa.py', url: 'http://proxy/api/storage/qa' },
      ],
      packagesByLang: {
        python: Array.from({ length: 15 }, (_, i) => `pkg${i}`),
        node: Array.from({ length: 10 }, (_, i) => `npm${i}`),
      },
      outputUploadSlots: [],
      outputUrlEndpoint: 'http://proxy/api/sandbox/output_upload_url',
      reportUploadedEndpoint: 'http://proxy/api/sandbox/record_uploaded',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/combined.*limit/i);
  });
});
