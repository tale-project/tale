// @vitest-environment node

/**
 * The branding over MCP, through the writer the Branding page uses: the
 * config store is a temporary directory, the database a double that runs
 * the writer's transaction, and the audit chain a double that records.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import {
  resolveBrandingFilePath,
  resolveImagesDir,
} from '../../core/branding/file_utils.ts';
import type { McpCaller } from '../mcp/caller.ts';
import { applySettings } from '../mcp/settings/apply.ts';
import { getSettings } from '../mcp/settings/get.ts';
import { planSettings } from '../mcp/settings/plan.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { brandingSettings } from './settings-resource.ts';

const registry = { branding: brandingSettings };

function contextOf(role: string): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: `user-${role}`,
    role,
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  const tag = async () => [{ email: `${role}@example.test` }];
  const sql = Object.assign(tag, {
    begin: (work: (tx: unknown) => Promise<unknown>) => work(tag),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, caller };
}

const change = (config: unknown) => ({
  kind: 'branding' as const,
  op: 'set' as const,
  config,
});

/** A branding file as the page, or an older release, left it. */
async function storedFile(config: unknown): Promise<void> {
  const file = resolveBrandingFilePath('acme');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

async function uploadedImage(filename: string): Promise<void> {
  const dir = resolveImagesDir('acme');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), '<svg/>');
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tale-branding-kind-'));
  vi.stubEnv('TALE_CONFIG_DIR', dir);
  createAuditLog.mockReset();
  createAuditLog.mockResolvedValue('row-1');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('who reads and changes the branding [MCP-R10]', () => {
  it('lets an owner or admin read and change it, and refuses everyone else as the page does', async () => {
    await storedFile({ accentColor: '#112233' });
    for (const role of ['owner', 'admin']) {
      expect(await brandingSettings.access(contextOf(role))).toEqual({
        read: true,
        write: true,
      });
    }
    for (const role of ['developer', 'member']) {
      expect(await brandingSettings.access(contextOf(role))).toEqual({
        read: false,
        write: false,
      });
      const answer = await getSettings(contextOf(role), registry, {
        kinds: ['branding'],
      });
      expect(answer.refused).toEqual([
        {
          kind: 'branding',
          code: 'ORG_FORBIDDEN',
          error: `Role "${role}" lacks the org-settings capability required to modify branding.`,
        },
      ]);
      expect(answer.resources).toEqual([]);
    }
  });
});

describe('reading the branding', () => {
  it('reads a file the old colour field still carries as the page shows it, so sending it back changes nothing', async () => {
    await storedFile({ brandColor: '#112233', logoFilename: 'logo.svg' });
    const answer = await getSettings(contextOf('admin'), registry, {
      kinds: ['branding'],
    });
    expect(answer.resources).toEqual([
      expect.objectContaining({
        key: 'branding',
        config: { accentColor: '#112233', logoFilename: 'logo.svg' },
      }),
    ]);
    await uploadedImage('logo.svg');
    const plan = await planSettings(contextOf('admin'), registry, [
      change({ accentColor: '#112233', logoFilename: 'logo.svg' }),
    ]);
    expect(plan.changes[0]).toMatchObject({ action: 'unchanged' });
  });
});

describe('planning a branding change', () => {
  it('takes a new accent colour, at low risk', async () => {
    await storedFile({ accentColor: '#112233' });
    const plan = await planSettings(contextOf('admin'), registry, [
      change({ accentColor: '#445566' }),
    ]);
    expect(plan.changes[0]).toMatchObject({
      action: 'update',
      diff: [{ path: '/accentColor', before: '#112233', after: '#445566' }],
      effects: [],
      risk: 'low',
    });
  });

  it.each(['logo.png', '../other-org/logo.svg', 'images/logo.svg'])(
    'refuses %j, which names no uploaded image',
    async (logoFilename) => {
      const plan = await planSettings(contextOf('admin'), registry, [
        change({ accentColor: '#445566', logoFilename }),
      ]);
      expect(plan.changes[0]?.refusal).toMatchObject({
        code: 'BRANDING_IMAGE_UNKNOWN',
        error:
          '/config/logoFilename names no image uploaded to this organization',
        hint: expect.stringContaining('Settings > Branding'),
      });
    },
  );

  it('keeps an uploaded image, and refuses the old colour field or one the branding lacks', async () => {
    await uploadedImage('favicon-light.png');
    const kept = await planSettings(contextOf('admin'), registry, [
      change({ faviconLightFilename: 'favicon-light.png' }),
    ]);
    expect(kept.changes[0]).toMatchObject({ action: 'create' });
    const legacy = await planSettings(contextOf('admin'), registry, [
      change({ brandColor: '#445566', textLogo: 'Acme' }),
    ]);
    expect(legacy.changes[0]?.refusal).toMatchObject({
      code: 'SETTINGS_INVALID',
      data: {
        issues: [
          expect.objectContaining({ path: '/config/brandColor' }),
          expect.objectContaining({ path: '/config/textLogo' }),
        ],
      },
    });
  });
});

describe('applying a branding change', () => {
  it('saves through the page’s writer, audited under the person who holds the key', async () => {
    await storedFile({ accentColor: '#112233' });
    const [current] = (
      await getSettings(contextOf('admin'), registry, { kinds: ['branding'] })
    ).resources as Array<{ hash: string }>;
    const answer = await applySettings(
      contextOf('admin'),
      registry,
      [change({ accentColor: '#445566' })],
      { branding: current?.hash ?? null },
    );
    const read = await brandingSettings.read(contextOf('admin'), null);
    expect(answer).toEqual({
      applied: [
        {
          kind: 'branding',
          id: null,
          key: 'branding',
          action: 'update',
          hash: read?.hash,
        },
      ],
      skipped: [],
    });
    expect(read?.config).toEqual({ accentColor: '#445566' });
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(createAuditLog.mock.lastCall?.[1]).toMatchObject({
      action: 'branding.updated',
      actorId: 'user-admin',
      actorEmail: 'admin@example.test',
      newState: { accentColor: '#445566' },
    });
  });

  it('lands only on the branding the agent read', async () => {
    await storedFile({ accentColor: '#112233' });
    const [read] = (
      await getSettings(contextOf('admin'), registry, { kinds: ['branding'] })
    ).resources as Array<{ hash: string }>;
    // Someone saves another colour in Tale after the agent read it.
    await storedFile({ accentColor: '#778899' });
    const answer = await applySettings(
      contextOf('admin'),
      registry,
      [change({ accentColor: '#445566' })],
      { branding: read?.hash ?? null },
    );
    expect(answer).toMatchObject({ code: 'SETTINGS_STALE', applied: [] });
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
