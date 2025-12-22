import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_URL = 'http://127.0.0.1:6791';
const PROXY_PREFIX = '/api/convex-dashboard-proxy';
const MAX_LOADING_RETRIES = 10; // Max retry attempts before showing error (~20 seconds)

/**
 * Reverse proxy for Convex Dashboard.
 *
 * This proxy handles requests to the dashboard including:
 * - Static assets (/_next/, favicon, etc.)
 * - Dashboard HTML/JS/CSS files
 *
 * It rewrites paths in HTML/JS/CSS so that all dashboard asset requests go through
 * this proxy, avoiding conflicts with the platform's own routes.
 *
 * Note: Convex API calls are rewritten to /convex-dashboard-api/... and handled
 * by Next.js rewrites in next.config.ts which forward them to the Convex backend.
 */
async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const pathSegments = slug || [];
  const targetPath = '/' + pathSegments.join('/');
  const targetUrl = `${DASHBOARD_URL}${targetPath}${request.nextUrl.search}`;

  try {
    // Build headers to forward
    const headers = new Headers();
    headers.set('Accept', request.headers.get('Accept') || '*/*');
    const acceptEncoding = request.headers.get('Accept-Encoding');
    if (acceptEncoding) headers.set('Accept-Encoding', acceptEncoding);
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);
    const authorization = request.headers.get('Authorization');
    if (authorization) headers.set('Authorization', authorization);
    const cookie = request.headers.get('Cookie');
    if (cookie) headers.set('Cookie', cookie);

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Include body for non-GET/HEAD requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      fetchOptions.body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseContentType = response.headers.get('content-type') || '';

    // Security guard: If the root path returns JSON instead of HTML, the dashboard
    // is likely still initializing or in an error state. Block this to prevent
    // exposing sensitive deployment data (including admin keys) in the JSON response.
    if (
      targetPath === '/' &&
      responseContentType.toLowerCase().includes('application/json')
    ) {
      console.warn(
        'Dashboard proxy: Blocking JSON response at root path to prevent credential exposure',
      );

      // Track retry attempts to prevent infinite refresh loops
      const retryCount = parseInt(
        request.nextUrl.searchParams.get('_retry') || '0',
        10,
      );

      if (retryCount >= MAX_LOADING_RETRIES) {
        // Show error page after max retries
        return new NextResponse(
          `<!DOCTYPE html>
<html>
<head>
  <title>Dashboard Unavailable</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; max-width: 500px; padding: 20px; }
    .error { font-size: 48px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error">⚠️</div>
    <h2>Dashboard Unavailable</h2>
    <p>The dashboard is currently unavailable. Please try again later or contact support if the problem persists.</p>
  </div>
</body>
</html>`,
          {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          },
        );
      }

      // Return loading page with incremented retry counter
      const nextRetry = retryCount + 1;
      return new NextResponse(
        `<!DOCTYPE html>
<html>
<head>
  <title>Dashboard Loading</title>
  <meta http-equiv="refresh" content="2;url=${PROXY_PREFIX}?_retry=${nextRetry}">
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid #e0e0e0; border-top-color: #666; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Dashboard is loading, please wait...</p>
  </div>
</body>
</html>`,
        {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      );
    }

    // For HTML responses, rewrite asset and API paths
    if (responseContentType.includes('text/html')) {
      let html = await response.text();

      // Rewrite /_next/ paths (only if not already rewritten)
      // Use negative lookahead to avoid double-rewriting
      html = html.replace(
        /"\/(?!api\/convex-dashboard-proxy)_next\//g,
        `"${PROXY_PREFIX}/_next/`,
      );
      html = html.replace(
        /'\/(?!api\/convex-dashboard-proxy)_next\//g,
        `'${PROXY_PREFIX}/_next/`,
      );

      // Rewrite /favicon paths
      html = html.replace(/"\/favicon/g, `"${PROXY_PREFIX}/favicon`);

      // Rewrite other root-level static assets (logos, images)
      html = html.replace(/"\/convex-/g, `"${PROXY_PREFIX}/convex-`);
      html = html.replace(/'\/convex-/g, `'${PROXY_PREFIX}/convex-`);

      return new NextResponse(html, {
        status: response.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // For JavaScript responses, rewrite dynamic import and API paths
    if (responseContentType.includes('javascript')) {
      let js = await response.text();

      // Rewrite /_next/ paths (only if not already rewritten)
      js = js.replace(
        /"\/(?!api\/convex-dashboard-proxy)_next\//g,
        `"${PROXY_PREFIX}/_next/`,
      );
      js = js.replace(
        /'\/(?!api\/convex-dashboard-proxy)_next\//g,
        `'${PROXY_PREFIX}/_next/`,
      );
      js = js.replace(
        /`\/(?!api\/convex-dashboard-proxy)_next\//g,
        `\`${PROXY_PREFIX}/_next/`,
      );

      // Rewrite other root-level static assets (logos, images)
      js = js.replace(/"\/convex-/g, `"${PROXY_PREFIX}/convex-`);
      js = js.replace(/'\/convex-/g, `'${PROXY_PREFIX}/convex-`);
      js = js.replace(/`\/convex-/g, `\`${PROXY_PREFIX}/convex-`);

      // Rewrite Convex API paths: "/api/" -> "/convex-dashboard-api/"
      // The dashboard uses new URL("/api/...", deploymentUrl) which resolves to
      // http://localhost:3000/api/... These are rewritten to /convex-dashboard-api/...
      // and handled by Next.js rewrites in next.config.ts.
      // Use negative lookahead to avoid rewriting /api/convex-dashboard-proxy/ paths
      // Use separate replacements to preserve quote types
      js = js.replace(
        /"\/api\/(?!convex-dashboard-proxy)/g,
        '"/convex-dashboard-api/',
      );
      js = js.replace(
        /'\/api\/(?!convex-dashboard-proxy)/g,
        "'/convex-dashboard-api/",
      );
      js = js.replace(
        /"\/instance_name"/g,
        '"/convex-dashboard-api/instance_name"',
      );

      return new NextResponse(js, {
        status: response.status,
        headers: {
          'Content-Type': responseContentType,
          'Cache-Control':
            response.headers.get('cache-control') ||
            'public, max-age=31536000, immutable',
        },
      });
    }

    // For CSS responses, rewrite url() paths
    if (responseContentType.includes('text/css')) {
      let css = await response.text();

      // Rewrite url(/_next/...) paths (only if not already rewritten)
      css = css.replace(
        /url\(\/(?!api\/convex-dashboard-proxy)_next\//g,
        `url(${PROXY_PREFIX}/_next/`,
      );

      // Rewrite other root-level static assets
      css = css.replace(/url\(\/convex-/g, `url(${PROXY_PREFIX}/convex-`);

      return new NextResponse(css, {
        status: response.status,
        headers: {
          'Content-Type': responseContentType,
          'Cache-Control':
            response.headers.get('cache-control') ||
            'public, max-age=31536000, immutable',
        },
      });
    }

    // For other responses (JSON, binary, etc.), pass through as-is
    const body = await response.arrayBuffer();
    const responseHeaders = new Headers();

    if (responseContentType)
      responseHeaders.set('Content-Type', responseContentType);
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) responseHeaders.set('Cache-Control', cacheControl);

    return new NextResponse(body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Dashboard proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy dashboard request' },
      { status: 502 },
    );
  }
}

// Export handlers for all HTTP methods
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}
