import { httpAction } from '../_generated/server';
import { ssoDiscoverHandler as ssoDiscoverHandlerFn } from './sso_discover_handler';
import { ssoAuthorizeHandler as ssoAuthorizeHandlerFn } from './sso_authorize_handler';
import { ssoCallbackHandler as ssoCallbackHandlerFn } from './sso_callback_handler';
import { ssoSetSessionHandler as ssoSetSessionHandlerFn } from './sso_set_session_handler';

export const ssoDiscoverHandler = httpAction(async (ctx, req) => ssoDiscoverHandlerFn(ctx, req));

export const ssoAuthorizeHandler = httpAction(async (ctx, req) => ssoAuthorizeHandlerFn(ctx, req));

export const ssoCallbackHandler = httpAction(async (ctx, req) => ssoCallbackHandlerFn(ctx, req));

export const ssoSetSessionHandler = httpAction(async (ctx, req) =>
  ssoSetSessionHandlerFn(ctx, req),
);
