import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

// Mock the session client + step runner so the test exercises the render
// dispatch contract (build script → reserve → stage → run → read back →
// teardown) without a live sandbox.
const sessionCreate = vi.fn();
const sessionDestroy = vi.fn();
const sessionStageFiles = vi.fn();
const sessionReadFile = vi.fn();
const runStepsInSession = vi.fn();

vi.mock('../../node_only/sandbox/helpers/session_client', () => ({
  SessionDuplicateError: class SessionDuplicateError extends Error {},
  sessionCreate: (...args: unknown[]) => sessionCreate(...args),
  sessionDestroy: (...args: unknown[]) => sessionDestroy(...args),
  sessionStageFiles: (...args: unknown[]) => sessionStageFiles(...args),
  sessionReadFile: (...args: unknown[]) => sessionReadFile(...args),
}));
vi.mock('../../node_only/sandbox/session_exec', () => ({
  runStepsInSession: (...args: unknown[]) => runStepsInSession(...args),
}));
vi.mock('../../lib/helpers/public_storage_url', () => ({
  toSandboxStorageUrl: (url: string) => `sandbox:${url}`,
  SANDBOX_CONVEX_STORAGE_BASE_DEFAULT: 'http://convex:3210',
}));

// Storage + mutation stubs shared across `createCtx()` so tests can inspect
// what the render script was staged as (the session-bound stage-file URL),
// what blob the produced document was persisted with, and the reserve args.
const storageStore = vi.fn();
const storageGetUrl = vi.fn();
const storageDelete = vi.fn();
const runMutation = vi.fn();

import { SessionDuplicateError } from '../../node_only/sandbox/helpers/session_client';
import {
  renderDocumentInSandbox,
  type SandboxRenderRequest,
} from './sandbox_render_document';

/** A typed ActionCtx stub exposing only the members the render path uses. */
function createCtx(): ActionCtx {
  const ctx: ActionCtx = {
    runQuery: vi.fn(),
    runMutation,
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

function completedRun() {
  return { status: 'completed', exitCode: 0, stdout: '', stderr: '' };
}

function failedRun(stderr: string) {
  return { status: 'failed', exitCode: 1, stdout: '', stderr };
}

/** What `sessionReadFile` yields for the harvested output — the spawner serves
 * the generic octet-stream, never the real mime. */
function readBack(size = 4096) {
  return {
    bytes: new ArrayBuffer(size),
    contentType: 'application/octet-stream',
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

/** Read back the render script staged via `ctx.storage.store(new Blob(...))` —
 * the FIRST store call (the produced document is stored second). */
async function stagedScript(): Promise<string> {
  const blob = storageStore.mock.calls[0]?.[0];
  return await blob.text();
}

beforeEach(() => {
  // reserveSessionSlotAndInsert resolves the session rowId; the status
  // mutations' resolved values are unused.
  runMutation.mockReset().mockResolvedValue('session-row-1');
  sessionCreate.mockReset().mockResolvedValue({ created: true });
  sessionDestroy.mockReset().mockResolvedValue(true);
  sessionStageFiles.mockReset().mockResolvedValue({ staged: 1 });
  sessionReadFile.mockReset().mockResolvedValue(readBack());
  runStepsInSession.mockReset().mockResolvedValue(completedRun());
  storageStore
    .mockReset()
    .mockResolvedValueOnce('script-storage-1')
    .mockResolvedValue('storage-out-1');
  storageGetUrl.mockReset().mockResolvedValue('https://storage/script');
  storageDelete.mockReset().mockResolvedValue(undefined);
});

describe('renderDocumentInSandbox', () => {
  it('runs the render in an ephemeral session and returns the stored output', async () => {
    const ctx = createCtx();

    const result = await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      PDF_REQUEST,
    );

    expect(result.storageId).toBe('storage-out-1');
    expect(result.size).toBe(4096);
    expect(result.contentType).toBe('application/pdf');

    // The slot is reserved from the isolated per-org 'render' budget before
    // the session is created.
    const [, reserveArgs] = runMutation.mock.calls[0] ?? [];
    expect(reserveArgs).toMatchObject({
      organizationId: 'org-1',
      ownerType: 'render',
      profile: 'default',
      createdBy: 'crawler',
    });
    const [createBody] = sessionCreate.mock.calls[0] ?? [];
    expect(createBody.sessionId).toMatch(/^rnd-/);
    expect(createBody.organizationId).toBe('org-1');

    // Script is staged in Convex storage and handed to the session as an
    // internal http(s) URL — NOT a `data:` URL (the spawner rejects those and
    // caps stage-file URLs at 4096 chars).
    expect(sessionStageFiles).toHaveBeenCalledWith(createBody.sessionId, [
      { path: 'code/render.js', url: 'sandbox:https://storage/script' },
    ]);
    expect(runStepsInSession).toHaveBeenCalledWith(createBody.sessionId, {
      stepPaths: ['/user/code/render.js'],
      timeoutMs: 60_000,
    });
    expect(sessionReadFile).toHaveBeenCalledWith(
      createBody.sessionId,
      '/user/output/document.pdf',
    );

    // The produced blob carries the real mime, not the session read's generic
    // octet-stream (the storage upload rejects a type-less blob, and the
    // deliverable is served to the user with this type).
    const outputBlob = storageStore.mock.calls[1]?.[0];
    expect(outputBlob.type).toBe('application/pdf');

    // The ephemeral session + the transient render-script blob are torn down.
    expect(sessionDestroy).toHaveBeenCalledWith(createBody.sessionId);
    expect(storageDelete).toHaveBeenCalledWith('script-storage-1');
  });

  it('embeds the PDF options + HTML in the render script', async () => {
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
    // (it is NOT on the session runner's NODE_PATH), not a bare require.
    expect(script).toContain("require.resolve('playwright'");
    expect(script).toContain('@playwright/mcp');
    // Output must land in the render harvest dir (/user/output) — that is the
    // path the session read-back fetches.
    expect(script).toContain('/user/output');
    expect(script).not.toContain('/workspace');
  });

  it('requests the jpeg output filename for jpeg images', async () => {
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
    expect(result.contentType).toBe('image/jpeg');
    expect(sessionReadFile).toHaveBeenCalledWith(
      expect.any(String),
      '/user/output/document.jpeg',
    );
    const script = await stagedScript();
    expect(script).toContain('page.screenshot');
    expect(script).toContain('deviceScaleFactor');
  });

  it('stages large HTML in storage, keeping the stage-file url within the spawner limits', async () => {
    // Regression: the script inlines the full document HTML, which used to be
    // base64-encoded into a `data:` URL — blowing past the spawner's 4096-char
    // cap (and its http(s)-scheme requirement) for any non-trivial document.
    // The script must ride in a staged storage blob.
    const ctx = createCtx();
    const bigHtml = `<p>${'x'.repeat(20_000)}</p>`;

    await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      { ...PDF_REQUEST, source: { kind: 'html', html: bigHtml } },
    );

    const [, stagedFiles] = sessionStageFiles.mock.calls[0] ?? [];
    const url: string = stagedFiles[0].url;
    expect(url.startsWith('data:')).toBe(false);
    expect(url.length).toBeLessThanOrEqual(4096);
    expect(url).toBe('sandbox:https://storage/script');
    // The bulky HTML lives in the staged blob, not the URL.
    expect(await stagedScript()).toContain('x'.repeat(20_000));
  });

  it('reaps an orphaned duplicate session and retries the create once', async () => {
    // A deterministic-id collision can only be an orphan (the reserve
    // serializes platform-side creation) — destroy it and create again.
    sessionCreate
      .mockRejectedValueOnce(new SessionDuplicateError('duplicate'))
      .mockResolvedValueOnce({ created: true });
    const ctx = createCtx();

    const result = await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      PDF_REQUEST,
    );

    expect(result.storageId).toBe('storage-out-1');
    expect(sessionCreate).toHaveBeenCalledTimes(2);
    // Once to reap the orphan, once for the final teardown.
    expect(sessionDestroy).toHaveBeenCalledTimes(2);
  });

  it('throws when the session run does not complete, still tearing down', async () => {
    runStepsInSession.mockResolvedValue(failedRun('boom'));
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow('did not complete');
    // The session and the transient script blob never leak.
    expect(sessionDestroy).toHaveBeenCalled();
    expect(storageDelete).toHaveBeenCalledWith('script-storage-1');
  });

  it('surfaces the script stderr when the run fails with a runtime error', async () => {
    // A bare failed status is opaque; the real cause lives in stderr, which
    // must reach the thrown error.
    runStepsInSession.mockResolvedValue(
      failedRun("Error: Cannot find module 'playwright'\n    at render.js:1"),
    );
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow("Cannot find module 'playwright'");
  });

  it('throws when the expected output file is missing', async () => {
    sessionReadFile.mockResolvedValue(null);
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow('produced no document.pdf');
    expect(sessionDestroy).toHaveBeenCalled();
  });
});
