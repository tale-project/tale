// @vitest-environment node

/**
 * The node migration touches the real filesystem (snapshot + atomicWrite), so
 * this runs in the node environment. It exercises the handler directly with a
 * stub Convex ctx — org enumeration is covered by the runner tests; this proves
 * the brandColor→accentColor merge rules and the fs-snapshot rollback.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { atomicWrite, readFileSafe } from '../../../../lib/file_io';
import {
  restoreFsTree,
  snapshotFsTree,
} from '../../../framework/snapshot_store';
import type {
  NodeMigrationCtx,
  NodeMigrationHelpers,
} from '../../../framework/types';
import { migration } from './index';

const helpers: NodeMigrationHelpers = {
  atomicWrite,
  readFileSafe,
  snapshotFsTree,
  restoreFsTree,
};

const ctx: NodeMigrationCtx = {
  runQuery: async () => null,
  runMutation: async () => null,
  runAction: async () => null,
};

const ORG = { id: 'org1', slug: 'org1' };

describe('0.3.4/01 branding_single_accent_color', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tale-mig-branding-'));
    vi.stubEnv('TALE_CONFIG_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const filePath = () => path.join(dir, 'org1', 'branding', 'branding.json');

  async function writeBranding(config: Record<string, unknown>): Promise<void> {
    await mkdir(path.dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(config), 'utf-8');
  }

  async function readBranding(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(filePath(), 'utf-8'));
  }

  it('maps a lone brandColor onto accentColor and drops the key', async () => {
    await writeBranding({ brandColor: '#FF0055', logoFilename: 'logo.png' });

    await migration.up(ctx, ORG, helpers);

    expect(await readBranding()).toEqual({
      accentColor: '#FF0055',
      logoFilename: 'logo.png',
    });
  });

  it('keeps an explicitly-set accentColor when both fields are set', async () => {
    await writeBranding({ brandColor: '#FF0055', accentColor: '#00AA66' });

    await migration.up(ctx, ORG, helpers);

    expect(await readBranding()).toEqual({ accentColor: '#00AA66' });
  });

  it('treats an empty-string accentColor as unset', async () => {
    await writeBranding({ brandColor: '#FF0055', accentColor: '' });

    await migration.up(ctx, ORG, helpers);

    expect(await readBranding()).toEqual({ accentColor: '#FF0055' });
  });

  it('is a no-op when the org has no branding file', async () => {
    await migration.up(ctx, ORG, helpers);
    expect(await readFileSafe(filePath())).toBeNull();
  });

  it('is idempotent — a second run leaves the migrated file unchanged', async () => {
    await writeBranding({ brandColor: '#FF0055' });

    await migration.up(ctx, ORG, helpers);
    const first = await readFile(filePath(), 'utf-8');
    await migration.up(ctx, ORG, helpers);

    expect(await readFile(filePath(), 'utf-8')).toBe(first);
  });

  it('leaves an unparseable branding.json untouched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mkdir(path.dirname(filePath()), { recursive: true });
      await writeFile(filePath(), 'not json', 'utf-8');

      await migration.up(ctx, ORG, helpers);

      expect(await readFile(filePath(), 'utf-8')).toBe('not json');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('down restores the pre-migration branding dir from the snapshot', async () => {
    await writeBranding({ brandColor: '#FF0055', accentColor: '#00AA66' });

    await migration.up(ctx, ORG, helpers);
    expect(await readBranding()).toEqual({ accentColor: '#00AA66' });

    await migration.down(ctx, ORG, helpers);
    expect(await readBranding()).toEqual({
      brandColor: '#FF0055',
      accentColor: '#00AA66',
    });
  });
});
