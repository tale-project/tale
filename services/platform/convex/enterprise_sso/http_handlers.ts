import { httpAction } from '../_generated/server';
import { ssoAuthorizeHandler as ssoAuthorizeHandlerFn } from './login/authorize_handler';
import { ssoCallbackHandler as ssoCallbackHandlerFn } from './login/callback_handler';
import { ssoDiscoverHandler as ssoDiscoverHandlerFn } from './login/discover_handler';
import { ssoSetSessionHandler as ssoSetSessionHandlerFn } from './login/set_session_handler';
import { samlAcsHandler as samlAcsHandlerFn } from './saml/acs_handler';
import { samlLoginHandler as samlLoginHandlerFn } from './saml/login_handler';
import { samlMetadataHandler as samlMetadataHandlerFn } from './saml/metadata_handler';

export const ssoDiscoverHandler = httpAction(async (ctx, req) =>
  ssoDiscoverHandlerFn(ctx, req),
);
export const ssoAuthorizeHandler = httpAction(async (ctx, req) =>
  ssoAuthorizeHandlerFn(ctx, req),
);
export const ssoCallbackHandler = httpAction(async (ctx, req) =>
  ssoCallbackHandlerFn(ctx, req),
);
export const ssoSetSessionHandler = httpAction(async (ctx, req) =>
  ssoSetSessionHandlerFn(ctx, req),
);
export const samlMetadataHandler = httpAction(async (ctx, req) =>
  samlMetadataHandlerFn(ctx, req),
);
export const samlLoginHandler = httpAction(async (ctx, req) =>
  samlLoginHandlerFn(ctx, req),
);
export const samlAcsHandler = httpAction(async (ctx, req) =>
  samlAcsHandlerFn(ctx, req),
);
