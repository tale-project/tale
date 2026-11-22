import { isStandardGatewayProvider } from './gateway_standard_providers';

/**
 * How a model a session may call is named on the wire between a harness and
 * the model relay: `<record>/<model>`, where the record is the connector's
 * name for a standard provider and an organization-scoped name for any other
 * one. The names were the sandbox LLM gateway's provider records; the
 * in-process relay reads the same names, so a harness's model setting means
 * the same model on either (tale-project/tale#4942).
 */

/** Gateway provider name for a CUSTOM connector's per-(org, model) upstream.
 * The model's effective (baseUrl, apiFormat, key) lives on its own provider
 * record so model-level routing actually works — one gateway record holds
 * exactly one base_url + base_provider_type. The record is ORG-SCOPED: a
 * custom connector is an org-defined file (`<orgSlug>/providers/*.yml`) and
 * two orgs may define the same connector name with different endpoints or
 * wire formats. A shared `<slug>__<model>` record let the last org to
 * provision rewrite `base_url` for every org sharing the name — org A's
 * key then went to org B's endpoint — and an apiFormat flip recreated the
 * record and deleted the other orgs' keys. Only the gateway's STANDARD
 * providers (whose URL + format the gateway owns) keep one shared record.
 * `/` is sanitized out of the NAME segment because the gateway routes on the
 * FIRST `/`; the model id keeps its own form (matched against the key
 * catalog after the prefix is stripped). */
function customGatewayProviderName(
  organizationId: string,
  slug: string,
  modelId: string,
  anthropicHarnessLane = false,
): string {
  // A harness on the Anthropic-wire lane (Claude Code; Codex on a chat-only
  // upstream) of a connector that declares a native Anthropic harness endpoint
  // rides a DISTINCT record so its upstream (base_provider_type: anthropic)
  // never overwrites the OpenAI record other harnesses use for the same
  // (org, model). `__anthropic` is a safe suffix:
  // `/` is still stripped below, and the segment stays one gateway record name.
  const base = `${organizationId}__${slug}__${modelId}`;
  return (anthropicHarnessLane ? `${base}__anthropic` : base).replace(
    /\//g,
    '_',
  );
}

export interface GatewayRouting {
  /** Gateway provider (record) name the request routes to. */
  gatewayProvider: string;
  /** Full gateway model ref (`<gatewayProvider>/<modelId>`) for the harness
   * model env + the VK allowed_models. */
  gatewayModel: string;
}

/** Extra routing inputs beyond the (org, connector, model) triple. */
export interface GatewayRoutingOpts {
  /** The connector declares a native Anthropic harness endpoint AND the
   * requesting harness should ride it (it speaks the Anthropic wire, or the
   * Responses wire onto a chat-only upstream — `agent_serving.ts` decides), so
   * this session rides a distinct per-model record (`…__anthropic`) whose
   * upstream is that endpoint. A STANDARD connector that declares one (OpenRouter's Anthropic
   * Messages door) takes the same org-scoped record: the gateway's built-in
   * implementation of the vendor only speaks the OpenAI wire to it, so the
   * native pass-through needs a custom record of its own. Only serving sets
   * this flag, and only for a connector that declares the endpoint. */
  anthropicHarnessLane?: boolean;
}

/**
 * Map an (org, connector, catalog model id) triple onto gateway routing. A
 * standard connector name routes to the shared native provider record
 * (`<name>/<modelId>`); any other connector routes to the org's own
 * per-model upstream record (`<orgId>__<name>__<modelId>/<modelId>`), or its
 * anthropic-harness sibling (`…__anthropic/<modelId>`) when opts say so — a
 * standard connector on that lane takes the sibling too (its built-in
 * gateway implementation cannot ride the vendor's Anthropic door). Single
 * source of truth shared by the harness glue (model env), the mint (VK
 * binding), and the provisioner (record names) so they can never drift — pass
 * the SAME opts at every call site for one session's model.
 */
export function resolveGatewayRouting(
  organizationId: string,
  providerSlug: string,
  modelId: string,
  opts: GatewayRoutingOpts = {},
): GatewayRouting {
  if (
    isStandardGatewayProvider(providerSlug) &&
    opts.anthropicHarnessLane !== true
  ) {
    return {
      gatewayProvider: providerSlug,
      gatewayModel: `${providerSlug}/${modelId}`,
    };
  }
  const name = customGatewayProviderName(
    organizationId,
    providerSlug,
    modelId,
    opts.anthropicHarnessLane,
  );
  return { gatewayProvider: name, gatewayModel: `${name}/${modelId}` };
}

/** One model the virtual key may call: the connector it belongs to plus its
 * catalog id in that connector's own dialect. */
export interface AllowedModelRef {
  providerSlug: string;
  modelId: string;
  /** Route this model through the connector's native Anthropic harness
   * endpoint (the Anthropic-wire lane — Claude Code, and Codex on a chat-only
   * upstream). See {@link GatewayRoutingOpts}. */
  anthropicHarnessLane?: boolean;
}
