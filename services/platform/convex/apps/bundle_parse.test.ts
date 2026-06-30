import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { parseAppBundleZip } from './bundle_parse';

async function makeZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(files)) zip.file(p, c);
  return zip.generateAsync({ type: 'uint8array' });
}

const VALID_MANIFEST = JSON.stringify({
  name: 'My Private App',
  description: 'A private app',
  scope: 'project',
  requires: { integrations: ['github'] },
});

const WORKFLOW_JSON = '{"name":"Run","steps":[]}';
const AGENT_JSON = '{"name":"Worker"}';

/** Resolve the ConvexError `code` a rejected parse threw (or undefined). */
async function codeOf(bytes: Uint8Array): Promise<string | undefined> {
  try {
    await parseAppBundleZip(bytes);
    return undefined;
  } catch (err) {
    return (err as { data?: { code?: string } }).data?.code;
  }
}

describe('parseAppBundleZip', () => {
  it('parses a valid single-folder bundle and derives the slug from the folder', async () => {
    const bytes = await makeZip({
      'my-app/app.json': VALID_MANIFEST,
      'my-app/views/desk.json': '{"id":"desk","data":{}}',
      'my-app/scripts/run.sh': 'echo hi',
    });

    const parsed = await parseAppBundleZip(bytes);

    expect(parsed.slug).toBe('my-app');
    expect(parsed.manifest.name).toBe('My Private App');
    expect(parsed.manifest.scope).toBe('project');
    // app.json is always the first file; the two assets follow.
    expect(parsed.files[0].relPath).toBe('app.json');
    const paths = parsed.files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['app.json', 'scripts/run.sh', 'views/desk.json']);
    expect(parsed.totalBytes).toBeGreaterThan(0);
  });

  it('strips macOS __MACOSX metadata before detecting the wrapper folder', async () => {
    const bytes = await makeZip({
      'my-app/app.json': VALID_MANIFEST,
      '__MACOSX/my-app/._app.json': 'junk',
    });
    const parsed = await parseAppBundleZip(bytes);
    expect(parsed.slug).toBe('my-app');
    expect(parsed.files.map((f) => f.relPath)).toEqual(['app.json']);
  });

  it('rejects a bundle with no single wrapper folder (app.json at root)', async () => {
    const bytes = await makeZip({ 'app.json': VALID_MANIFEST });
    expect(await codeOf(bytes)).toBe('MISSING_WRAPPER_FOLDER');
  });

  it('rejects a wrapper folder name that is not a valid app slug', async () => {
    const bytes = await makeZip({ 'My_App/app.json': VALID_MANIFEST });
    expect(await codeOf(bytes)).toBe('INVALID_SLUG');
  });

  it('rejects a bundle missing app.json at the folder root', async () => {
    const bytes = await makeZip({ 'my-app/views/desk.json': '{}' });
    expect(await codeOf(bytes)).toBe('MISSING_MANIFEST');
  });

  it('rejects an app.json that fails manifest validation', async () => {
    // `name` is required by appManifestSchema; omit it.
    const bytes = await makeZip({
      'my-app/app.json': JSON.stringify({ description: 'no name' }),
    });
    expect(await codeOf(bytes)).toBe('INVALID_MANIFEST');
  });

  it('refuses a bundle where an entry escapes the wrapper folder', async () => {
    // JSZip normalizes `my-app/../evil.txt` to the root `evil.txt`, so the
    // bundle no longer has a single wrapper folder — refused.
    const bytes = await makeZip({
      'my-app/app.json': VALID_MANIFEST,
      'my-app/../evil.txt': 'pwned',
    });
    expect(await codeOf(bytes)).toBe('MISSING_WRAPPER_FOLDER');
  });

  it('accepts an app-scoped workflow + agent whose files are present', async () => {
    const bytes = await makeZip({
      'my-app/app.json': JSON.stringify({
        name: 'My App',
        workflows: ['my-app/run'],
        agents: ['worker'],
      }),
      'my-app/workflows/my-app/run.json': WORKFLOW_JSON,
      'my-app/agents/worker.json': AGENT_JSON,
    });
    const parsed = await parseAppBundleZip(bytes);
    expect(parsed.manifest.workflows).toEqual(['my-app/run']);
  });

  it('rejects a workflow declared without the app-slug prefix', async () => {
    const bytes = await makeZip({
      'my-app/app.json': JSON.stringify({
        name: 'My App',
        workflows: ['run'],
      }),
      'my-app/workflows/run.json': WORKFLOW_JSON,
    });
    expect(await codeOf(bytes)).toBe('INVALID_WORKFLOW_REF');
  });

  it('rejects a declared workflow whose file is missing from the bundle', async () => {
    const bytes = await makeZip({
      'my-app/app.json': JSON.stringify({
        name: 'My App',
        workflows: ['my-app/run'],
      }),
    });
    expect(await codeOf(bytes)).toBe('MISSING_WORKFLOW_FILE');
  });

  it('rejects a declared agent whose file is missing from the bundle', async () => {
    const bytes = await makeZip({
      'my-app/app.json': JSON.stringify({
        name: 'My App',
        agents: ['worker'],
      }),
    });
    expect(await codeOf(bytes)).toBe('MISSING_AGENT_FILE');
  });

  it('rejects a non-zip payload', async () => {
    expect(await codeOf(new TextEncoder().encode('not a zip'))).toBe(
      'INVALID_BUNDLE',
    );
  });
});
