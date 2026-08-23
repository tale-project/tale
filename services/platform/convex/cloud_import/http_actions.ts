import { httpAction } from '../_generated/server';
import {
  cloudImportOauth2CallbackHandler,
  cloudImportOauth2StartHandler,
} from './oauth_handlers';

export const cloudImportOauth2StartHandlerHttp = httpAction(async (ctx, req) =>
  cloudImportOauth2StartHandler(ctx, req),
);

export const cloudImportOauth2CallbackHandlerHttp = httpAction(
  async (ctx, req) => cloudImportOauth2CallbackHandler(ctx, req),
);
