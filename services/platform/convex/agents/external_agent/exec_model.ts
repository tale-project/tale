// Model id for the external-agent CLI exec (`--model` / ANTHROPIC_MODEL).
// Pure so the routing matrix is unit-testable; run_external_agent injects the
// gateway resolver (a 'use node' import this module must not carry).
//
// The 'default' sentinel (or empty) means "no pinned model" → return undefined
// so the adapter omits --model and the runtime falls back to its own default.
// This matters most for gateway-less runtimes (e.g. a BYO Cursor with
// supportedModels: []): every chat turn carries modelRef 'default', and
// resolving THAT through the gateway mapper yields the nonsense id
// `default__default/default`, which the Cursor CLI rejects (exit 1). Verified
// in-sandbox 2026-07-04.

export interface ExecModelArgs {
  /** BYO run — the user's own credential talks to the vendor directly. */
  byo: boolean;
  /** Managed run routed through the sandbox LLM gateway. */
  gatewayRun: boolean;
  /** Tale model ref from the turn ('default' = unpinned). */
  modelRef: string;
  /** Which id dialect the runtime's BYO backend speaks (the adapter's
   * `credentialPolicy.byoModelIdSource`). Default 'vendor-native'. 'catalog'
   * is for OpenRouter-style backends (Hermes + OPENROUTER_API_KEY), where the
   * vendor-native translation is an id the backend rejects. */
  byoModelIdSource?: 'vendor-native' | 'catalog' | undefined;
  /** Catalog vendor-native id for a BYO catalog-shaped ref (gateway ids do
   * not exist on the vendor's own API). */
  byoNativeModel?: string | undefined;
  /** Catalog id (the ref minus its provider prefix) for a BYO catalog-shaped
   * ref — what a 'catalog'-dialect backend must request
   * (`anthropic/claude-sonnet-4.6`, the OpenRouter id). */
  byoCatalogModel?: string | undefined;
  /** Tale ref → gateway model id (`resolveGatewayRoutingFromRef(...).gatewayModel`). */
  toGatewayModel: (taleModelRef: string) => string;
}

export function resolveExternalAgentExecModel(
  args: ExecModelArgs,
): string | undefined {
  if (!args.modelRef || args.modelRef === 'default') return undefined;
  // BYO: the id the runtime's own backend knows — vendor-native or catalog per
  // the adapter's dialect — when the catalog matched; a raw user-typed id
  // passes through unchanged.
  if (args.byo) {
    const catalogMapped =
      args.byoModelIdSource === 'catalog'
        ? args.byoCatalogModel
        : args.byoNativeModel;
    return catalogMapped ?? args.modelRef;
  }
  // Gateway-managed: the canonical gateway routing — must match the VK mint.
  if (args.gatewayRun) return args.toGatewayModel(args.modelRef);
  // Env-managed (gateway-less, e.g. Cursor): the runtime talks to its own
  // backend, which only knows its native ids — pass the ref through raw.
  return args.modelRef;
}
