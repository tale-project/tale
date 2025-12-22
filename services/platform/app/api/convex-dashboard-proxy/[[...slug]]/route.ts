import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_URL = 'http://127.0.0.1:6791';
const PROXY_PREFIX = '/api/convex-dashboard-proxy';

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
      js = js.replace(
        /["']\/api\/(?!convex-dashboard-proxy)/g,
        '"/convex-dashboard-api/',
      );
      js = js.replace(
        /"\/instance_name"/g,
        '"/convex-dashboard-api/instance_name"',
      );

      // Strip /ws_api from URLs that have it before /api/ or /convex-dashboard-api/
      // This handles the case where the backend's --convex-origin includes /ws_api
      // and the dashboard builds full URLs like "https://example.com/ws_api/api/..."
      // We need to remove /ws_api so the URL becomes "https://example.com/convex-dashboard-api/..."
      js = js.replace(
        /\/ws_api\/convex-dashboard-api\//g,
        '/convex-dashboard-api/',
      );
      js = js.replace(/\/ws_api\/api\//g, '/convex-dashboard-api/');

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug?: string[] }> },
) {
  return proxyRequest(request, context);
}
