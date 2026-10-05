// @vitest-environment node

import { randomBytes } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { stageWorkflowFiles } from './agent_host';

vi.mock('../node_only/sandbox/helpers/stage_url', () => ({
  stageUrlForBlobRef: vi.fn(async () => 'https://files.invalid/child.txt'),
}));

let root: string;
let deletes: string[];
const sessionId = 'file-mount-transition';
const organizationId = 'A'.repeat(32);
const ctx = {
  runQuery: vi.fn(async () => ({
    files: [{ fileId: 'blob-child', name: 'child.txt' }],
    truncated: false,
  })),
} as unknown as ActionCtx;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-file-mount-'));
  deletes = [];
  vi.stubEnv('SANDBOX_URL', 'http://file-mount.invalid');
  vi.stubEnv('SANDBOX_TOKEN', randomBytes(32).toString('hex'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (target: string, init?: RequestInit) => {
      const url = new URL(target);
      if (init?.method === 'GET') {
        const folder = join(root, url.searchParams.get('path') ?? '.');
        try {
          const entries = await readdir(folder, { withFileTypes: true });
          return Response.json({
            entries: entries.map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? 'dir' : 'file',
              size: 0,
              mtimeMs: 0,
            })),
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      }
      expect(
        new Headers(init?.headers).get('x-tale-sandbox-signature'),
      ).toMatch(/^[a-f0-9]{64}$/);
      if (typeof init?.body !== 'string')
        throw new Error('Expected a serialized staging request');
      const body = JSON.parse(init.body) as {
        paths?: string[];
        files?: Array<{ path: string; contentBase64?: string; url?: string }>;
      };
      if (url.pathname.endsWith('/files/delete')) {
        for (const path of body.paths ?? []) {
          deletes.push(path);
          await rm(join(root, path), { recursive: true, force: true });
        }
        return Response.json({ deleted: body.paths, skipped: [] });
      }
      expect(url.pathname.endsWith('/files/stage')).toBe(true);
      const staged: Array<{ path: string; bytes: number }> = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (const file of body.files ?? []) {
        if (file.contentBase64 === undefined && file.url === undefined) {
          skipped.push({ path: file.path, reason: 'no_source' });
          continue;
        }
        try {
          const destination = join(root, file.path);
          await mkdir(dirname(destination), { recursive: true });
          const bytes =
            file.contentBase64 === undefined
              ? Buffer.from('folder child')
              : Buffer.from(file.contentBase64, 'base64');
          await writeFile(destination, bytes);
          staged.push({ path: file.path, bytes: bytes.length });
        } catch (error) {
          skipped.push({ path: file.path, reason: String(error) });
        }
      }
      return Response.json({ staged, skipped, reconciled: true });
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const stage = (source: string | { content: string }) =>
  stageWorkflowFiles(
    ctx,
    organizationId,
    sessionId,
    { data: source },
    'inputs/',
  );

it('replaces a previous inline mount with a folder before staging its children', async () => {
  await stage({ content: 'inline contents' });
  await expect(stage('folder-id')).resolves.toMatchObject({ mounts: ['data'] });
  expect(await readFile(join(root, 'inputs/data/child.txt'), 'utf8')).toBe(
    'folder child',
  );
  expect(deletes).toEqual(['inputs/data', 'inputs/data']);
});

it('replaces a previous folder mount with inline content', async () => {
  await stage('folder-id');
  await stage({ content: 'inline contents' });
  expect(await readFile(join(root, 'inputs/data'), 'utf8')).toBe(
    'inline contents',
  );
  expect(deletes).toEqual(['inputs/data', 'inputs/data']);
});

it('preserves an existing directory mount for verified cache reuse', async () => {
  await stage('folder-id');
  const inode = (await stat(join(root, 'inputs/data'))).ino;
  deletes = [];
  await stage('folder-id');
  expect(deletes).toEqual([]);
  expect((await stat(join(root, 'inputs/data'))).ino).toBe(inode);
});
