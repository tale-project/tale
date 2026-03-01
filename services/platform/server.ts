import { join, resolve } from 'node:path';

interface EnvConfig {
  SITE_URL: string | undefined;
  MICROSOFT_AUTH_ENABLED: boolean;
  SENTRY_DSN: string | undefined;
  SENTRY_TRACES_SAMPLE_RATE: number;
  TALE_VERSION: string | undefined;
}

const port = process.env.PORT || 3000;
const distDir = join(import.meta.dir, 'dist');

let indexHtmlTemplate: string | null = null;

function getEnvConfig(): EnvConfig {
  return {
    SITE_URL: process.env.SITE_URL,
    MICROSOFT_AUTH_ENABLED: !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_TRACES_SAMPLE_RATE: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0',
    ),
    TALE_VERSION: process.env.TALE_VERSION,
  };
}

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    if (pathname !== '/') {
      const filePath = resolve(distDir, pathname.slice(1));
      if (filePath.startsWith(distDir)) {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      }
    }

    if (!indexHtmlTemplate) {
      indexHtmlTemplate = await Bun.file(join(distDir, 'index.html')).text();
    }

    const envConfig = getEnvConfig();
    const acceptLanguage = request.headers.get('accept-language') ?? '';

    const html = indexHtmlTemplate
      .replace(
        /window\.__ENV__\s*=\s*['"]__ENV_PLACEHOLDER__['"];/,
        `window.__ENV__ = ${JSON.stringify(envConfig)};`,
      )
      .replace(
        /window\.__ACCEPT_LANGUAGE__\s*=\s*['"]__ACCEPT_LANGUAGE_PLACEHOLDER__['"];/,
        `window.__ACCEPT_LANGUAGE__ = ${JSON.stringify(acceptLanguage)};`,
      );

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  },
});

console.log(`Server running on http://0.0.0.0:${port}`);
