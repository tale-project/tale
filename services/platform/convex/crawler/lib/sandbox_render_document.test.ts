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
      getUrl: vi.fn(),
      getMetadata: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      store: vi.fn(),
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

beforeEach(() => {
  spawnerExecute.mockReset();
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
    // Script is staged as a base64 data URL.
    expect(body.files[0].url).toMatch(/^data:text\/javascript;base64,/);
  });

  it('embeds the PDF options + HTML in the render script', async () => {
    spawnerExecute.mockResolvedValue(completed('document.pdf'));
    const ctx = createCtx();
    await renderDocumentInSandbox(
      { ctx, organizationId: 'org-1' },
      PDF_REQUEST,
    );

    const [body] = spawnerExecute.mock.calls[0] ?? [];
    const dataUrl: string = body.files[0].url;
    const base64 = dataUrl.replace('data:text/javascript;base64,', '');
    const script = Buffer.from(base64, 'base64').toString('utf8');
    expect(script).toContain('page.pdf');
    expect(script).toContain('A4');
    expect(script).toContain('<p>Hi</p>');
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
    const [body] = spawnerExecute.mock.calls[0] ?? [];
    const base64 = body.files[0].url.replace(
      'data:text/javascript;base64,',
      '',
    );
    const script = Buffer.from(base64, 'base64').toString('utf8');
    expect(script).toContain('page.screenshot');
    expect(script).toContain('deviceScaleFactor');
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

  it('throws when the expected output file is missing', async () => {
    spawnerExecute.mockResolvedValue(completed('other.pdf'));
    const ctx = createCtx();
    await expect(
      renderDocumentInSandbox({ ctx, organizationId: 'org-1' }, PDF_REQUEST),
    ).rejects.toThrow('no document.pdf output file');
  });
});
