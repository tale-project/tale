import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBrandingFilePath } from '../../core/branding/file_utils.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  BrandingError,
  changedBrandingFields,
  deleteBrandingImage,
  readBrandingConfig,
  saveBranding,
  saveBrandingImage,
} from './service';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * The branding writes take the config-store write lock inside a
 * transaction, so they need a database handle. These tests are about the
 * intake gate, the bytes on disk and the audit rows, not the lock, so the
 * double just runs the callback.
 */
function fakeSql(): Sql {
  const tag = () => Promise.resolve([]);
  const begin = (callback: (tx: unknown) => Promise<unknown>) => callback(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { begin } as unknown as Sql;
}

const ACTOR = {
  organizationId: 'org-1',
  userId: 'user-1',
  email: 'ada@example.test',
};

const audited = () => vi.mocked(createAuditLog).mock.calls.map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveBrandingImage — SVG active-content intake gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Regression for the stored-XSS class: a scripted SVG logo must be
  // refused at intake with a precise code (the serving side additionally
  // sandboxes whatever is on disk — this gate is the UX layer).
  it('rejects an SVG containing a script element before touching disk', async () => {
    await expect(
      saveBrandingImage(
        fakeSql(),
        'acme',
        {
          type: 'logo',
          base64: toBase64(
            '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
          ),
          mimeType: 'image/svg+xml',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({
      name: 'BrandingError',
      code: 'IMAGE_SVG_ACTIVE_CONTENT',
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('rejects an SVG with an event-handler attribute', async () => {
    await expect(
      saveBrandingImage(
        fakeSql(),
        'acme',
        {
          type: 'logo',
          base64: toBase64('<svg onload="fetch(`/api/x`)"><rect/></svg>'),
          mimeType: 'image/svg+xml',
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(BrandingError);
  });

  it('stores a benign SVG logo', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-svc-'));
    try {
      vi.stubEnv('TALE_CONFIG_DIR', configDir);
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#123"/></svg>';
      const result = await saveBrandingImage(
        fakeSql(),
        'acme',
        {
          type: 'logo',
          base64: toBase64(svg),
          mimeType: 'image/svg+xml',
        },
        ACTOR,
      );
      expect(result.filename).toBe('logo.svg');
      const written = await readFile(
        join(configDir, 'acme', 'branding', 'images', 'logo.svg'),
        'utf8',
      );
      expect(written).toBe(svg);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('does not scan non-SVG uploads for markup-shaped bytes', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-svc-'));
    try {
      vi.stubEnv('TALE_CONFIG_DIR', configDir);
      // A raster payload whose bytes happen to contain handler-shaped text
      // must pass — the gate is specific to the scriptable SVG document
      // format.
      const result = await saveBrandingImage(
        fakeSql(),
        'acme',
        {
          type: 'favicon-light',
          base64: toBase64('PNGDATA onload="x" <script>'),
          mimeType: 'image/png',
        },
        ACTOR,
      );
      expect(result.filename).toBe('favicon-light.png');
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

describe('image writes record their reference on the branding config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The docs and the settings page promise an upload takes effect at once;
  // the reference used to be staged in the form and written only by the
  // header's Save, so a reload before that Save showed the default again
  // (SET-F29).
  it('names the stored file on save and forgets it on delete', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-svc-'));
    try {
      vi.stubEnv('TALE_CONFIG_DIR', configDir);
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
      await saveBrandingImage(
        fakeSql(),
        'acme',
        {
          type: 'logo',
          base64: toBase64(svg),
          mimeType: 'image/svg+xml',
        },
        ACTOR,
      );
      const afterSave = await readBrandingConfig('acme');
      expect(afterSave.config).toMatchObject({ logoFilename: 'logo.svg' });
      expect(
        JSON.parse(await readFile(resolveBrandingFilePath('acme'), 'utf8')),
      ).toMatchObject({ logoFilename: 'logo.svg' });

      await deleteBrandingImage(fakeSql(), 'acme', 'logo', ACTOR);
      const afterDelete = await readBrandingConfig('acme');
      expect(afterDelete.config).not.toHaveProperty('logoFilename');

      // Both writes left their rows on the organization, under the admin.
      expect(audited()).toEqual([
        expect.objectContaining({
          organizationId: 'org-1',
          actorId: 'user-1',
          actorEmail: 'ada@example.test',
          actorType: 'user',
          action: 'branding.image_uploaded',
          category: 'admin',
          resourceType: 'organization',
          resourceId: 'org-1',
          metadata: { type: 'logo', filename: 'logo.svg', bytes: svg.length },
          status: 'success',
        }),
        expect.objectContaining({
          action: 'branding.image_deleted',
          metadata: { type: 'logo' },
        }),
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

describe('saveBranding — the audit row', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // A branding change is an organization-wide change every member sees;
  // the row names what changed, and a save that re-sent the stored values
  // leaves none.
  it('records the fields that changed, and nothing for a save that changed nothing', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-svc-'));
    try {
      vi.stubEnv('TALE_CONFIG_DIR', configDir);

      const first = await saveBranding(
        fakeSql(),
        'acme',
        { accentColor: '#123456' },
        undefined,
        ACTOR,
      );
      expect(first.hash).toHaveLength(64);
      expect(audited()).toEqual([
        expect.objectContaining({
          organizationId: 'org-1',
          actorId: 'user-1',
          action: 'branding.updated',
          category: 'admin',
          resourceType: 'organization',
          resourceId: 'org-1',
          previousState: {},
          newState: { accentColor: '#123456' },
          changedFields: ['accentColor'],
        }),
      ]);

      vi.clearAllMocks();
      const again = await saveBranding(
        fakeSql(),
        'acme',
        { accentColor: '#123456' },
        first.hash,
        ACTOR,
      );
      expect(again.hash).toBe(first.hash);
      expect(audited()).toEqual([]);

      await saveBranding(
        fakeSql(),
        'acme',
        { accentColor: '#654321', logoFilename: 'logo.svg' },
        first.hash,
        ACTOR,
      );
      expect(audited()).toEqual([
        expect.objectContaining({
          action: 'branding.updated',
          previousState: { accentColor: '#123456' },
          newState: { accentColor: '#654321', logoFilename: 'logo.svg' },
          changedFields: ['accentColor', 'logoFilename'],
        }),
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('refuses a stale expected hash before touching the file or the log', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-svc-'));
    try {
      vi.stubEnv('TALE_CONFIG_DIR', configDir);
      await saveBranding(
        fakeSql(),
        'acme',
        { accentColor: '#123456' },
        undefined,
        ACTOR,
      );
      vi.clearAllMocks();
      await expect(
        saveBranding(
          fakeSql(),
          'acme',
          { accentColor: '#000000' },
          'stale-hash',
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
      expect(audited()).toEqual([]);
      expect(await readBrandingConfig('acme')).toMatchObject({
        config: { accentColor: '#123456' },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});

describe('changedBrandingFields', () => {
  it('names added, removed and changed keys, sorted', () => {
    expect(
      changedBrandingFields(
        { accentColor: '#1', logoFilename: 'a.svg', faviconDarkFilename: 'x' },
        { accentColor: '#2', logoFilename: 'a.svg', faviconLightFilename: 'y' },
      ),
    ).toEqual(['accentColor', 'faviconDarkFilename', 'faviconLightFilename']);
  });
});
