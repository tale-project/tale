import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { type Plugin } from 'vite';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

export function serveBrandingImages(): Plugin {
  // Branding is default-only on the read side (see branding/file_actions.ts).
  // On-disk location: `${TALE_CONFIG_DIR}/default/branding/images/`.
  const configDir = process.env.TALE_CONFIG_DIR;
  const imagesDir = configDir
    ? join(configDir, 'default', 'branding', 'images')
    : null;

  return {
    name: 'serve-branding-images',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!imagesDir || !req.url?.startsWith('/branding/images/')) {
          next();
          return;
        }

        // Parse via URL so query strings (e.g. ?v=2 cache-busters)
        // and fragments are dropped before filename validation. Without
        // this, /branding/images/logo.png?v=2 became filename
        // 'logo.png?v=2' which then failed existsSync and 404'd in
        // dev — silently diverging from the prod handler that uses
        // c.req.param('filename') (round-3 P2 R3-P2-a).
        const url = new URL(req.url, 'http://x');
        const filename = url.pathname.slice('/branding/images/'.length);
        if (!filename || filename.includes('/') || filename.includes('..')) {
          next();
          return;
        }

        const filePath = resolve(imagesDir, filename);
        // `+ sep` defense-in-depth so a future sibling dir whose name
        // is a string prefix of imagesDir (e.g. `imagesXYZ/`) can't be
        // matched by raw startsWith if the filename filter ever loosens.
        if (!filePath.startsWith(imagesDir + sep) || !existsSync(filePath)) {
          next();
          return;
        }

        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

        void readFile(filePath)
          .then((data) => {
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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
            next();
          });
      });
    },
  };
}
