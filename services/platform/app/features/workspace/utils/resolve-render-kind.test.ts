import { describe, expect, it } from 'vitest';

import { resolveRenderKind } from './resolve-render-kind';

describe('resolveRenderKind (#2677)', () => {
  it("a stored 'attachment' hint on text content is advisory — inference decides, so uploaded files render like agent-written ones", () => {
    // The pre-#2677 uploader stamped 'attachment' on every non-image upload;
    // these persisted rows must heal without a migration.
    expect(resolveRenderKind('attachment', 'notes.md', 'text/markdown')).toBe(
      'markdown',
    );
    expect(resolveRenderKind('attachment', 'flow.mmd', undefined)).toBe(
      'mermaid',
    );
    expect(resolveRenderKind('attachment', 'page.html', 'text/html')).toBe(
      'html',
    );
    expect(
      resolveRenderKind('attachment', 'logo.svg', 'application/octet-stream'),
    ).toBe('svg');
    expect(resolveRenderKind('attachment', 'script.py', 'text/x-python')).toBe(
      'code',
    );
  });

  it("genuinely binary content keeps the download-only view, hinted 'attachment' or not", () => {
    expect(
      resolveRenderKind('attachment', 'report.pdf', 'application/pdf'),
    ).toBe('attachment');
    expect(resolveRenderKind(undefined, 'archive.zip', 'application/zip')).toBe(
      'attachment',
    );
  });

  it('all other hints stay authoritative', () => {
    expect(resolveRenderKind('image', 'chart', undefined)).toBe('image');
    expect(resolveRenderKind('markdown', 'README', undefined)).toBe('markdown');
    expect(resolveRenderKind('code', 'notes.md', 'text/markdown')).toBe('code');
  });

  it('unhinted rows infer from extension, then content type', () => {
    expect(resolveRenderKind(undefined, 'photo.png', undefined)).toBe('image');
    expect(resolveRenderKind(undefined, 'photo', 'image/jpeg')).toBe('image');
    expect(resolveRenderKind(undefined, 'notes.md', undefined)).toBe(
      'markdown',
    );
    expect(resolveRenderKind(undefined, 'main.ts', undefined)).toBe('code');
  });
});
