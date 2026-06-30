import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

// Mock the spawner client + storage-url helper so the test exercises the
// dispatch contract without a live sandbox.
const spawnerExecute = vi.fn();
vi.mock('../../node_only/sandbox/helpers/spawner_client', () => ({
  spawnerExecute: (...args: unknown[]) => spawnerExecute(...args),
}));
vi.mock('../../lib/helpers/public_storage_url', () => ({
  toSandboxStorageUrl: (url: string) => `sandbox:${url}`,
  SANDBOX_CONVEX_STORAGE_BASE_DEFAULT: 'http://convex:3210',
}));

// Storage stubs shared across `createCtx()` so tests can inspect what the render
// script was staged as (the spawner-bound `files[].url`).
const storageStore = vi.fn();
const storageGetUrl = vi.fn();
const storageDelete = vi.fn();

import {
  renderDocumentInSandbox,
  type SandboxRenderRequest,
} from './sandbox_render_document';

/** A typed ActionCtx stub exposing only the storage members the helper uses. */
function createCtx(): ActionCtx {
  const ctx: ActionCtx = {
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    runAction: vi.fn(),
    scheduler: { runAfter: vi.fn(), runAt: vi.fn(), cancel: vi.fn() },
    auth: { getUserIdentity: vi.fn() },
    storage: {
      generateUploadUrl: vi.fn().mockResolvedValue('https://upload/slot'),
      getUrl: storageGetUrl,
      getMetadata: vi.fn(),
      delete: storageDelete,
      get: vi.fn(),
      store: storageStore,
    },
    vectorSearch: vi.fn(),
  };
  return ctx;
}

interface MockSpawnerResponse {
  status: string;
  exitCode: number;
  stdoutBase64: string;
  stderrBase64: string;
  durationMs: number;
  truncated: { stdout: boolean; stderr: boolean; files: number };
  outputFiles: Array<{
    name: string;
    storageId: string;
    size: number;
    contentType: string;
    sha256: string;
  }>;
}

function completed(name: string): MockSpawnerResponse {
  return {
    status: 'completed',
    exitCode: 0,
    stdoutBase64: '',
    stderrBase64: '',
    durationMs: 1,
    truncated: { stdout: false, stderr: false, files: 0 },
    outputFiles: [
      {
        name,
        storageId: 'storage-out-1',
        size: 4096,
        contentType: name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
        sha256: 'abc',
      },
    ],
  };
}

const PDF_REQUEST: SandboxRenderRequest = {
  output: 'pdf',
  source: { kind: 'html', html: '<p>Hi</p>' },
  pdf: {
    format: 'A4',
    landscape: false,
    marginTop: '20mm',
    marginBottom: '20mm',
    marginLeft: '20mm',
    marginRight: '20mm',
    printBackground: true,
  },
};

/** Read back the render script staged via `ctx.storage.store(new Blob(...))`. */
async function stagedScript(): Promise<string> {
  const blob = storageStore.mock.calls[0]?.[0];
  return await blob.text();
}

beforeEach(() => {
  spawnerExecute.mockReset();
  storageStore.mockReset().mockResolvedValue('script-storage-1');
  storageGetUrl.mockReset().mockResolvedValue('https://storage/script');
  storageDelete.mockReset().mockResolvedValue(undefined);
});

describe('renderDocumentInSandbox', () => {
  it('dispatches a node render and returns the produced storageId', async () => {
    spawnerExecute.mockResolvedValue(completed('document.pdf'));
    const ctx = createCtx();

    const result = await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      PDF_REQUEST,
    );

    expect(result.storageId).toBe('storage-out-1');
    expect(result.size).toBe(4096);
    expect(result.contentType).toBe('application/pdf');

    const [body] = spawnerExecute.mock.calls[0] ?? [];
    expect(body.language).toBe('node');
    expect(body.entryPath).toBe('render.js');
    expect(body.organizationId).toBe('org-1');
    expect(body.outputUploadSlots).toEqual([
      { url: 'sandbox:https://upload/slot' },
    ]);
    // Script is staged in Convex storage and handed to the spawner as an
    // internal http(s) URL — NOT a `data:` URL (the spawner rejects those and
    // caps `files[].url` at 4096 chars).
    expect(body.files[0].url).toBe('sandbox:https://storage/script');
    // The transient render-script blob is cleaned up after the run.
    expect(storageDelete).toHaveBeenCalledWith('script-storage-1');
  });

  it('embeds the PDF options + HTML in the render script', async () => {
    spawnerExecute.mockResolvedValue(completed('document.pdf'));
    const ctx = createCtx();
    await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      PDF_REQUEST,
    );

    const script = await stagedScript();
    expect(script).toContain('page.pdf');
    expect(script).toContain('A4');
    expect(script).toContain('<p>Hi</p>');
    // Playwright must be resolved from the image's baked Playwright MCP bundle
    // (it is NOT on the one-shot runner's NODE_PATH), not a bare require.
    expect(script).toContain("require.resolve('playwright'");
    expect(script).toContain('@playwright/mcp');
  });

  it('requests the jpeg output filename for jpeg images', async () => {
    spawnerExecute.mockResolvedValue(completed('document.jpeg'));
    const ctx = createCtx();
    const result = await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      {
        output: 'image',
        source: { kind: 'url', url: 'https://example.com', waitUntil: 'load' },
        image: {
          imageType: 'jpeg',
          quality: 80,
          fullPage: true,
          width: 1200,
          height: 1080,
          scale: 2,
        },
      },
    );
    expect(result.storageId).toBe('storage-out-1');
    const script = await stagedScript();
    expect(script).toContain('page.screenshot');
    expect(script).toContain('deviceScaleFactor');
  });

  it('stages large HTML in storage, keeping files[].url within the spawner limits', async () => {
    // Regression: the script inlines the full document HTML, which used to be
    // base64-encoded into a `data:` URL and passed as `files[0].url` — blowing
    // past the spawner's 4096-char cap (and its http(s)-scheme requirement) for
    // any non-trivial document. The script must ride in a staged storage blob.
    spawnerExecute.mockResolvedValue(completed('document.pdf'));
    const ctx = createCtx();
    const bigHtml = `<p>${'x'.repeat(20_000)}</p>`;

    await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      { ...PDF_REQUEST, source: { kind: 'html', html: bigHtml } },
    );

    const [body] = spawnerExecute.mock.calls[0] ?? [];
    const url: string = body.files[0].url;
    expect(url.startsWith('data:')).toBe(false);
    expect(url.length).toBeLessThanOrEqual(4096);
    expect(url).toBe('sandbox:https://storage/script');
    // The bulky HTML lives in the staged blob, not the URL.
    expect(await stagedScript()).toContain('x'.repeat(20_000));
  });

  it('throws when the spawner does not complete', async () => {
    spawnerExecute.mockResolvedValue({
      status: 'failed',
      errorCode: 'SPAWNER_UNAVAILABLE',
      errorMessage: 'boom',
      exitCode: 1,
      stdoutBase64: '',
      stderrBase64: '',
      durationMs: 1,
      truncated: { stdout: false, stderr: false, files: 0 },
      outputFiles: [],
    });
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow('did not complete');
  });

  it('surfaces the script stderr when the run fails with a runtime error', async () => {
    // A RUNTIME_ERROR alone ("User code exited with status 1") is opaque; the
    // real cause lives in stderr, which must reach the thrown error.
    spawnerExecute.mockResolvedValue({
      status: 'failed',
      errorCode: 'RUNTIME_ERROR: User code exited with status 1',
      exitCode: 1,
      stdoutBase64: '',
      stderrBase64: Buffer.from(
        "Error: Cannot find module 'playwright'\n    at render.js:1",
        'utf8',
      ).toString('base64'),
      durationMs: 1,
      truncated: { stdout: false, stderr: false, files: 0 },
      outputFiles: [],
    });
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow("stderr: Error: Cannot find module 'playwright'");
  });

  it('throws when the expected output file is missing', async () => {
    spawnerExecute.mockResolvedValue(completed('other.pdf'));
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow('no document.pdf output file');
  });
});
