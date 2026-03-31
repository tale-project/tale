import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
  const configDir = process.env.TALE_CONFIG_DIR;
  const imagesDir = configDir ? join(configDir, 'branding', 'images') : null;

  return {
    name: 'serve-branding-images',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!imagesDir || !req.url?.startsWith('/branding/images/')) {
          next();
          return;
        }

        const filename = req.url.slice('/branding/images/'.length);
        if (!filename || filename.includes('/') || filename.includes('..')) {
          next();
          return;
        }

        const filePath = resolve(imagesDir, filename);
        if (!filePath.startsWith(imagesDir) || !existsSync(filePath)) {
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
          .catch(() => {
            next();
          });
      });
    },
  };
}
