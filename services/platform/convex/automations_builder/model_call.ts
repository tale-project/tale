'use node';

/**
 * The builder session's model call.
 *
 * The model is ALWAYS explicit: the caller names the provider connector and
 * the model id, and nothing here substitutes a "best" one. An authoring
 * session can run for a dozen turns and spend real money, so which model that
 * is stays the operator's decision, exactly as it is for an `llm` node.
 *
 * Only `api-key` and `env` credentials can serve this call. Both subscription
 * flavors carry execution constraints binding them to a specific vendor
 * harness — pointing them at a chat endpoint would be using someone's coding
 * subscription as a raw API key — so they are refused with a message that
 * says which credential to configure instead.
 *
 * The credential and connector are resolved once per session and reused for
 * its turns: a session is minutes long, and re-reading and re-decrypting the
 * secret on every turn buys nothing.
 */

import { ConvexError } from 'convex/values';

import type { BuilderModel } from '../../lib/automations_builder/session';
import { providerAttributionHeaders } from '../../lib/shared/providers/attribution';
import type { ApiFormat } from '../../lib/shared/schemas/providers';
import type { ActionCtx } from '../_generated/server';
import { safeFetch, SafeFetchError } from '../lib/http/safe_fetch';
import { resolveConnectorsForOrgId } from '../lib/providers/org_connectors';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { buildChatRequest, parseChatReply } from './chat_wire';

/** A model, named the way the platform names models everywhere else. */
export interface BuilderModelTarget {
  providerSlug: string;
  modelId: string;
}

/** An authoring turn writes a whole workflow document; a reply cut in half
 * costs a turn to rediscover. */
const MAX_REPLY_TOKENS = 8000;
/** Authoring turns are long: reasoning plus a full document. */
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Enough of an upstream error to act on, never enough to leak a body. */
const ERROR_EXCERPT = 300;

interface WireTarget {
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string;
  attribution: Record<string, string>;
}

async function resolveWireTarget(
  ctx: ActionCtx,
  organizationId: string,
  target: BuilderModelTarget,
): Promise<WireTarget> {
  const connector = (await resolveConnectorsForOrgId(ctx, organizationId)).find(
    (entry) => entry.name === target.providerSlug,
  );
  if (!connector) {
    throw new ConvexError({
      code: 'PROVIDER_UNKNOWN',
      message: `Unknown provider "${target.providerSlug}" — no shipped or org-defined connector by that name.`,
    });
  }

  const credential = await resolveProviderCredential(ctx, {
    organizationId,
    providerSlug: target.providerSlug,
  });
  if (credential.authMethod !== 'api-key' && credential.authMethod !== 'env') {
    throw new ConvexError({
      code: 'BUILDER_MODEL_CREDENTIAL_UNSUPPORTED',
      message: `The default "${target.providerSlug}" credential is a ${credential.authMethod} credential, which is bound to a vendor harness and cannot serve a direct model call. Configure an API-key or environment-variable credential for the automation builder.`,
    });
  }

  const baseUrl = credential.endpointUrl ?? connector.baseUrl;
  if (!baseUrl) {
    throw new ConvexError({
      code: 'PROVIDER_ENDPOINT_MISSING',
      message: `Provider "${target.providerSlug}" has no API endpoint — a per-credential connector needs the endpoint stored on the credential.`,
    });
  }

  return {
    apiFormat: connector.apiFormat,
    baseUrl,
    apiKey: credential.secret,
    attribution: providerAttributionHeaders({
      providerName: connector.name,
      baseUrl,
    }),
  };
}

export interface BuilderModelArgs {
  organizationId: string;
  target: BuilderModelTarget;
  /** Ceiling for one reply; defaults to a full document's worth. */
  maxTokens?: number;
}

/**
 * Build the session's model call. Failures surface as thrown errors with the
 * upstream detail redacted and truncated — the loop turns a failed model call
 * into a clean "gave up" outcome, so nothing here needs to retry.
 */
export function createBuilderModel(
  ctx: ActionCtx,
  args: BuilderModelArgs,
): BuilderModel {
  let wire: WireTarget | null = null;

  return async ({ messages, temperature }) => {
    wire ??= await resolveWireTarget(ctx, args.organizationId, args.target);
    const request = buildChatRequest({
      apiFormat: wire.apiFormat,
      baseUrl: wire.baseUrl,
      modelId: args.target.modelId,
      apiKey: wire.apiKey,
      messages,
      temperature,
      maxTokens: args.maxTokens ?? MAX_REPLY_TOKENS,
      extraHeaders: wire.attribution,
    });

    let response;
    try {
      response = await safeFetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      });
    } catch (error) {
      if (error instanceof SafeFetchError) {
        throw new Error(
          `${args.target.providerSlug} was unreachable (${error.kind}): ${sanitizeError(error, ERROR_EXCERPT)}`,
          { cause: error },
        );
      }
      throw error;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `${args.target.providerSlug} answered ${response.status}: ${sanitizeError(response.body, ERROR_EXCERPT)}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch (error) {
      throw new Error(
        `${args.target.providerSlug} returned a non-JSON body: ${sanitizeError(error, ERROR_EXCERPT)}`,
        { cause: error },
      );
    }
    return parseChatReply(wire.apiFormat, payload);
  };
}
