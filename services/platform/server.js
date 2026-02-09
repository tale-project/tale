import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

let indexHtmlTemplate = null;

function getEnvConfig() {
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

app.use(express.static(join(__dirname, 'dist'), { index: false }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('{*path}', (_req, res) => {
  if (!indexHtmlTemplate) {
    indexHtmlTemplate = readFileSync(
      join(__dirname, 'dist', 'index.html'),
      'utf-8',
    );
  }

  const envConfig = getEnvConfig();
  const html = indexHtmlTemplate.replace(
    'window.__ENV__ = "__ENV_PLACEHOLDER__";',
    `window.__ENV__ = ${JSON.stringify(envConfig)};`,
  );

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});
