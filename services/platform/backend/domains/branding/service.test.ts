import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrandingError, saveBrandingImage } from './service';

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('saveBrandingImage — SVG active-content intake gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Regression for the stored-XSS class: a scripted SVG logo must be
  // refused at intake with a precise code (the serving side additionally
  // sandboxes whatever is on disk — this gate is the UX layer).
  it('rejects an SVG containing a script element before touching disk', async () => {
    await expect(
      saveBrandingImage('acme', {
        type: 'logo',
        base64: toBase64(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
        ),
        mimeType: 'image/svg+xml',
      }),
    ).rejects.toMatchObject({
      name: 'BrandingError',
      code: 'IMAGE_SVG_ACTIVE_CONTENT',
    });
  });

  it('rejects an SVG with an event-handler attribute', async () => {
    await expect(
      saveBrandingImage('acme', {
        type: 'logo',
        base64: toBase64('<svg onload="fetch(`/api/x`)"><rect/></svg>'),
        mimeType: 'image/svg+xml',
      }),
    ).rejects.toBeInstanceOf(BrandingError);
  });

  it('stores a benign SVG logo', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'tale-branding-svc-'));
    try {
      vi.stubEnv('TALE_CONFIG_DIR', configDir);
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#123"/></svg>';
      const result = await saveBrandingImage('acme', {
        type: 'logo',
        base64: toBase64(svg),
        mimeType: 'image/svg+xml',
      });
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
      const result = await saveBrandingImage('acme', {
        type: 'favicon-light',
        base64: toBase64('PNGDATA onload="x" <script>'),
        mimeType: 'image/png',
      });
      expect(result.filename).toBe('favicon-light.png');
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
