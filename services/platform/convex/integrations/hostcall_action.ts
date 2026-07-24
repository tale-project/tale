'use node';

/**
 * Execute ONE platform-mediated HTTP request for a live connector body that is
 * running out of process (the sandbox-exec portable convention).
 *
 * The in-sandbox façade round-trips every `ctx.http.*` call here (via the
 * `/api/integrations/hostcall` route, which verified the one-run capability
 * token and owns nothing else). This action re-resolves the SAME credential
 * the dispatcher ran with and performs the request through the SAME
 * `createLiveHost` the in-process path uses — connector allowlist, https-only,
 * response caps, redirect re-checks, and Authorization injection all run here,
 * in their one existing implementation, never inside the sandbox.
 *
 * Returns a plain result object in both outcomes: `{status, headers,
 * bodyText}` for a performed request, `{error: {code, message}}` for a
 * refusal — the façade turns the latter into the throw the body would have
 * seen in process.
 */

import { v } from 'convex/values';

import { findIntegrationConnector } from '../../lib/integrations/catalog';
import { IntegrationError } from '../../lib/integrations/errors';
import { createLiveHost } from '../../lib/integrations/live-host';
import { internalAction } from '../_generated/server';
import { resolveIntegrationCredential } from '../integration_credentials/resolve_credential';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type HostcallMethod = (typeof HTTP_METHODS)[number];

function isHostcallMethod(value: string): value is HostcallMethod {
  return (HTTP_METHODS as readonly string[]).includes(value);
}

interface HostcallOutcome {
  status?: number;
  headers?: Record<string, string>;
  bodyText?: string;
  error?: { code: string; message: string };
}

export const performIntegrationHostCall = internalAction({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    actionName: v.string(),
    credentialRef: v.optional(v.string()),
    method: v.string(),
    url: v.string(),
    req: v.optional(
      v.object({
        headers: v.optional(v.record(v.string(), v.string())),
        body: v.optional(v.string()),
        responseType: v.optional(v.literal('base64')),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<HostcallOutcome> => {
    const connector = findIntegrationConnector(args.connectorSlug);
    if (!connector) {
      return {
        error: {
          code: 'UNKNOWN_CONNECTOR',
          message: `no shipped connector is named "${args.connectorSlug}"`,
        },
      };
    }
    if (!isHostcallMethod(args.method)) {
      return {
        error: {
          code: 'BAD_METHOD',
          message: `"${args.method}" is not an HTTP verb the integration host offers`,
        },
      };
    }

    try {
      const credential = await resolveIntegrationCredential(ctx, {
        organizationId: args.organizationId,
        connectorSlug: args.connectorSlug,
        ...(args.credentialRef !== undefined && {
          credentialRef: args.credentialRef,
        }),
      });
      const host = createLiveHost({
        connector,
        action: args.actionName,
        ...(credential.endpoint !== undefined && {
          endpoint: credential.endpoint,
        }),
        ...(credential.config !== undefined && { config: credential.config }),
        ...(credential.authHeader !== undefined && {
          authHeader: credential.authHeader,
        }),
      });
      const verb = args.method.toLowerCase() as Lowercase<HostcallMethod>;
      const response = await host.http[verb](args.url, {
        ...(args.req?.headers !== undefined && { headers: args.req.headers }),
        ...(args.req?.body !== undefined && { body: args.req.body }),
        ...(args.req?.responseType !== undefined && {
          responseType: args.req.responseType,
        }),
      });
      return {
        status: response.status,
        headers: response.headers,
        bodyText: response.text(),
      };
    } catch (error) {
      // A coded refusal (allowlist, https-only, credential, response cap)
      // crosses as data so the in-sandbox façade can rethrow it verbatim.
      if (error instanceof IntegrationError) {
        return { error: { code: error.code, message: error.message } };
      }
      console.error('[integrations-hostcall] request failed', error);
      return {
        error: {
          code: 'REQUEST_FAILED',
          message:
            error instanceof Error ? error.message : 'the request failed',
        },
      };
    }
  },
});
