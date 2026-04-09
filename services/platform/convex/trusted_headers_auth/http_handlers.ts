import { httpAction } from '../_generated/server';
import { trustedHeadersAuthenticateHandler } from './authenticate_handler';

export const trustedHeadersAuthHandler = httpAction(async (ctx, req) =>
  trustedHeadersAuthenticateHandler(ctx, req),
);
