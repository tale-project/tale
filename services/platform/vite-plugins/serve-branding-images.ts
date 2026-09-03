import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { type Connect, type Plugin } from 'vite';

import { isValidOrgSlug } from '../lib/shared/constants/org-slug';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

export function serveBrandingImages(): Plugin {
  // Per-org branding (mirrors the prod handler in server.ts). On-disk:
  // `${TALE_CONFIG_DIR}/<orgSlug>/branding/images/<filename>`. URL carries the
  // slug as a path segment: `/branding/images/<orgSlug>/<filename>`.
  const configDir = process.env.TALE_CONFIG_DIR;

  // Shared by dev (`configureServer`) and prod-build preview
  // (`configurePreviewServer`, the E2E serving path). No `apply: 'serve'` so
  // the preview hook can fire.
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!configDir || !req.url?.startsWith('/branding/images/')) {
      next();
      return;
    }

    // Parse via URL so query strings (e.g. ?v=2 cache-busters)
    // and fragments are dropped before validation. The path after the
    // prefix is `<orgSlug>/<filename>`; split into exactly two segments.
    const url = new URL(req.url, 'http://x');
    const rest = url.pathname.slice('/branding/images/'.length);
    const slashIndex = rest.indexOf('/');
    if (slashIndex === -1) {
      next();
      return;
    }
    const orgSlug = rest.slice(0, slashIndex);
    const filename = rest.slice(slashIndex + 1);
    if (
      !isValidOrgSlug(orgSlug) ||
      !filename ||
      filename.includes('/') ||
      filename.includes('..')
    ) {
      next();
      return;
    }

    const imagesDir = join(configDir, orgSlug, 'branding', 'images');
    const filePath = resolve(imagesDir, filename);
    // `+ sep` defense-in-depth so a future sibling dir whose name
    // is a string prefix of imagesDir (e.g. `imagesXYZ/`) can't be
    // matched by raw startsWith if the filename filter ever loosens.
    if (!filePath.startsWith(imagesDir + sep) || !existsSync(filePath)) {
      next();
      return;
    }

    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const contentType = MIME_TYPES[ext];
    // Unknown extension: fall through (Vite 404s), matching the prod
    // handler's allowlist-or-404 — never serve a guessable octet-stream.
    if (!contentType) {
      next();
      return;
    }

    void readFile(filePath)
      .then((data) => {
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        // Mirror the prod handler's hardening (see server.ts): branding
        // images are org-admin-uploaded bytes (SVG included) — a direct
        // navigation must never yield a scriptable same-origin document.
        // Bare `sandbox` gives any such navigation an inert opaque-origin
        // document; <img>/<link rel=icon> embeds are unaffected.
        res.setHeader('Content-Security-Policy', 'sandbox');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(data);
      })
      .catch((err: unknown) => {
        // ENOENT is the expected miss — fall through to the next
        // middleware so Vite's static handler / 404 page kicks in.
        // Other errors (EACCES, EISDIR) are worth a warning so a
        // misconfigured branding dir doesn't silently 404 forever.
        const code =
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          typeof err.code === 'string'
            ? err.code
            : undefined;
        if (code !== 'ENOENT') {
          console.warn(
            `[serve-branding-images] readFile ${filePath} failed:`,
            err,
          );
        }
        // Connect middleware hands off via next(); calling it from the catch
        // is the intended fall-through, not a callback/promise mix-up.
        // oxlint-disable-next-line promise/no-callback-in-promise
        next();
      });
  };

  return {
    name: 'serve-branding-images',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
