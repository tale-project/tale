import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Debug: log all requests
app.use((req, _res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`);
  next();
});

let indexHtmlTemplate = null;

function getEnvConfig() {
  return {
    SITE_URL: process.env.SITE_URL,
    MICROSOFT_AUTH_ENABLED: !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
  };
}

// Proxy Convex WebSocket API (for main app)
const convexWsProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:3210',
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/ws_api': '' },
});
app.use('/ws_api', convexWsProxy);

// Proxy Convex HTTP API
app.use(
  '/http_api',
  createProxyMiddleware({
    target: 'http://127.0.0.1:3211',
    changeOrigin: true,
    pathRewrite: { '^/http_api': '' },
  }),
);

// Proxy better-auth requests to Convex HTTP endpoint
app.use(
  '/api/auth',
  createProxyMiddleware({
    target: 'http://127.0.0.1:3211',
    changeOrigin: true,
    pathRewrite: (path) => `/api/auth${path}`,
  }),
);

// Proxy Convex Dashboard UI (with basePath=/convex-dashboard)
// Dashboard is configured with basePath, so all its routes start with /convex-dashboard
// Express strips the mount path, so we need to prepend /convex-dashboard back
// Note: ws is disabled here - Dashboard WebSocket goes through /api/:version/sync
app.use('/convex-dashboard', createProxyMiddleware({
  target: 'http://127.0.0.1:6791',
  changeOrigin: true,
  pathRewrite: (path) => {
    const newPath = `/convex-dashboard${path === '/' ? '' : path}`;
    return newPath;
  },
}));

// Proxy Convex backend API for Dashboard (HTTP and WebSocket)
// Dashboard uses /api/* for sync WebSocket and HTTP API calls
// These need to reach Convex backend (port 3210)
// Note: /api/auth is handled earlier by better-auth proxy

// Convex sync WebSocket - proxies /api/:version/sync to Convex backend
const convexSyncProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:3210',
  changeOrigin: true,
  ws: true,
  on: {
    error: (err) => {
      console.error('[ConvexSyncProxy Error]', err.message);
    },
  },
});
app.use('/api/:version/sync', convexSyncProxy);

// Convex HTTP API endpoints used by Dashboard
// These are called with "Authorization: Convex <admin_key>" header
const convexApiProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:3210',
  changeOrigin: true,
  pathRewrite: (path) => `/api${path}`,
});

app.use('/api', (req, res, next) => {
  // Skip routes handled elsewhere
  if (req.path.startsWith('/auth') || req.path === '/health') {
    return next();
  }
  // Proxy internal Convex action callbacks (from node runtime) to Convex backend
  // These paths are used by ctx.runMutation/runQuery/runAction inside 'use node' actions
  if (req.path.startsWith('/actions/')) {
    return convexApiProxy(req, res, next);
  }
  // Proxy requests with Convex authorization to Convex backend
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Convex ')) {
    return convexApiProxy(req, res, next);
  }
  next();
});

app.use(express.static(join(__dirname, 'dist'), { index: false }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('{*path}', (_req, res) => {
  if (!indexHtmlTemplate) {
    indexHtmlTemplate = readFileSync(join(__dirname, 'dist', 'index.html'), 'utf-8');
  }

  const envConfig = getEnvConfig();
  const html = indexHtmlTemplate.replace(
    'window.__ENV__ = "__ENV_PLACEHOLDER__";',
    `window.__ENV__ = ${JSON.stringify(envConfig)};`,
  );

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
});

// Setup WebSocket proxy for Convex API sync endpoint
// This handles WebSocket upgrade requests for /api/:version/sync
server.on('upgrade', (req, socket, head) => {
  const url = req.url;
  console.log(`[WebSocket Upgrade] ${url}`);

  if (url.startsWith('/ws_api')) {
    // Main app's Convex WebSocket connection
    convexWsProxy.upgrade(req, socket, head);
  } else if (url.match(/^\/api\/[\d.]+\/sync/)) {
    // Dashboard's Convex WebSocket connection
    convexSyncProxy.upgrade(req, socket, head);
  }
});
