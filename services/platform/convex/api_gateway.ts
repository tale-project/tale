import { httpAction } from './_generated/server';
import { createAuth } from './auth';

// CONVEX_URL is the cloud URL (handles /api/run/ paths via convex-helpers)
// In development: http://127.0.0.1:3210
// In production: https://xxx.convex.cloud
const CONVEX_URL = process.env.CONVEX_URL || 'http://127.0.0.1:3210';

function isAllowedOrigin(origin: string): boolean {
  const siteUrl = process.env.SITE_URL || 'http://127.0.0.1:3000';
  const siteOrigin = new URL(siteUrl).origin;

  if (origin === siteOrigin) {
    return true;
  }

  if (
    siteOrigin.includes('127.0.0.1') ||
    siteOrigin.includes('localhost')
  ) {
    return true;
  }

  return false;
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : '';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  };
}

function jsonError(message: string, status: number, request?: Request): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (request) {
    Object.assign(headers, getCorsHeaders(request));
  }
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function getConvexJwtFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  for (const cookie of cookies) {
    // Check both regular and __Secure- prefixed cookie names
    // Browsers add __Secure- prefix for cookies with Secure attribute on HTTPS
    if (cookie.startsWith('__Secure-better-auth.convex_jwt=')) {
      return cookie.substring('__Secure-better-auth.convex_jwt='.length);
    }
    if (cookie.startsWith('better-auth.convex_jwt=')) {
      return cookie.substring('better-auth.convex_jwt='.length);
    }
  }
  return null;
}

export const apiGatewayOptions = httpAction(async (_ctx, request) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
});

export const apiGatewayRun = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  return handleApiGateway(ctx, request, url.pathname);
});

async function handleApiGateway(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
  path: string,
): Promise<Response> {
  const apiKey = request.headers.get('x-api-key');
  const cookieHeader = request.headers.get('cookie');
  const convexJwt = getConvexJwtFromCookies(cookieHeader);

  if (!apiKey && !convexJwt) {
    return jsonError('Missing x-api-key header or session cookie', 401, request);
  }

  let jwtToken: string;

  if (convexJwt) {
    jwtToken = convexJwt;
  } else {
    const auth = createAuth(ctx);
    try {
      const result = await auth.api.getToken({
        headers: request.headers,
      });
      jwtToken = result.token;
    } catch {
      return jsonError('Invalid API key or session', 401, request);
    }
  }

  const body = await request.text();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${CONVEX_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        ...getCorsHeaders(request),
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[API Gateway] Request to Convex API timed out');
      return jsonError('Gateway timeout', 504, request);
    }
    console.error('[API Gateway] Failed to reach Convex API:', error);
    return jsonError('Internal server error', 500, request);
  }
}
