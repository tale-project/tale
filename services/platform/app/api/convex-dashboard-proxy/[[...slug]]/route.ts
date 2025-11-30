import { NextRequest, NextResponse } from 'next/server';

const DASHBOARD_URL = 'http://127.0.0.1:6791';

/**
 * Reverse proxy for Convex Dashboard that rewrites asset paths.
 *
 * The dashboard is a Next.js app with absolute `/_next/` paths in its HTML/JS.
 * This proxy rewrites those paths to `/convex-dashboard-proxy/_next/` so they
 * don't conflict with the platform's own `/_next/` assets.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const pathSegments = slug || [];
  const targetPath = '/' + pathSegments.join('/');
  const targetUrl = `${DASHBOARD_URL}${targetPath}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // Forward relevant headers
        Accept: request.headers.get('Accept') || '*/*',
        'Accept-Encoding': request.headers.get('Accept-Encoding') || '',
      },
    });

    const contentType = response.headers.get('content-type') || '';

    // For HTML responses, rewrite asset paths
    if (contentType.includes('text/html')) {
      let html = await response.text();

      // Rewrite /_next/ paths to /api/convex-dashboard-proxy/_next/
      html = html.replace(/"\/_next\//g, '"/api/convex-dashboard-proxy/_next/');
      html = html.replace(/'\/_next\//g, "'/api/convex-dashboard-proxy/_next/");

      // Rewrite /favicon paths
      html = html.replace(
        /"\/favicon/g,
        '"/api/convex-dashboard-proxy/favicon',
      );

      return new NextResponse(html, {
        status: response.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    // For JavaScript responses, rewrite dynamic import paths
    if (contentType.includes('javascript')) {
      let js = await response.text();

      // Rewrite /_next/ paths in JS (used for dynamic imports/chunks)
      js = js.replace(/"\/_next\//g, '"/api/convex-dashboard-proxy/_next/');
      js = js.replace(/'\/_next\//g, "'/api/convex-dashboard-proxy/_next/");
      js = js.replace(/`\/_next\//g, '`/api/convex-dashboard-proxy/_next/');

      return new NextResponse(js, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control':
            response.headers.get('cache-control') ||
            'public, max-age=31536000, immutable',
        },
      });
    }

    // For other responses, pass through as-is
    const body = await response.arrayBuffer();
    const headers = new Headers();

    // Copy relevant headers
    if (contentType) headers.set('Content-Type', contentType);
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) headers.set('Cache-Control', cacheControl);

    return new NextResponse(body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('Dashboard proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy dashboard request' },
      { status: 502 },
    );
  }
}
