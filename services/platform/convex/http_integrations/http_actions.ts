/**
 * The registered HTTP actions of the integrations routes.
 *
 * Thin `httpAction` wrappers over the handlers, so the handlers stay plain
 * functions of `(ctx, req)` that a test can call directly — the same split
 * `enterprise_sso/http_handlers.ts` uses.
 */

import { httpAction } from '../_generated/server';
import { oauth2CallbackHandler, oauth2StartHandler } from './oauth_handlers';
import { slackEventsHandler } from './slack_events';

export const integrationsOauth2StartHandler = httpAction(async (ctx, req) =>
  oauth2StartHandler(ctx, req),
);

export const integrationsOauth2CallbackHandler = httpAction(async (ctx, req) =>
  oauth2CallbackHandler(ctx, req),
);

export const integrationsSlackEventsHandler = httpAction(async (ctx, req) =>
  slackEventsHandler(ctx, req),
);
