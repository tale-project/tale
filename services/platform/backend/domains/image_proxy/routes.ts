import { Hono } from 'hono';
import type { Sql } from 'postgres';

import type { Auth } from '../../auth/auth.ts';
import { requireSession, type AuthEnv } from '../../auth/session.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import {
  decodeImageProxyTarget,
  fetchProxiedImage,
  ImageProxyError,
  type ProxiedImage,
} from './service.ts';

/**
 * `GET /api/image-proxy?url=<base64>` — a remote image an email draws,
 * fetched by the backend (see `service.ts`). Signed-in readers only, charged
 * per person. The answer is an image and nothing else: its type is the one
 * the bytes were detected as, and a sandboxing CSP keeps it inert even when
 * opened on its own, since it is served from the app's origin.
 */
export function createImageProxyRoutes(deps: {
  auth: Auth;
  sql: Sql;
  fetchImage?: typeof fetchProxiedImage;
}): Hono<AuthEnv> {
  const fetchImage = deps.fetchImage ?? fetchProxiedImage;
  const app = new Hono<AuthEnv>();

  app.get('/', requireSession(deps.auth), async (c) => {
    try {
      await checkUserRateLimit(
        deps.sql,
        'security:image-proxy',
        c.get('sessionBundle').user.id,
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        return rateLimitedResponse(c, error);
      }
      throw error;
    }

    let image: ProxiedImage;
    try {
      image = await fetchImage(decodeImageProxyTarget(c.req.query('url')));
    } catch (error) {
      if (error instanceof ImageProxyError) {
        return c.json(
          { error: error.message, code: error.code },
          error.status,
          { 'cache-control': 'no-store' },
        );
      }
      throw error;
    }

    return c.body(image.bytes, 200, {
      'content-type': image.contentType,
      'content-length': String(image.bytes.byteLength),
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=3600',
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
    });
  });

  return app;
}
