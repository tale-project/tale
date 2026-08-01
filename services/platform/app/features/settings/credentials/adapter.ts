import { type ComponentType, type ReactNode } from 'react';

import { type EntityRowAction } from '@/app/components/ui/entity/entity-row-actions';

/**
 * The contract that lets one credential UI serve both the connectors page and
 * the AI-providers page.
 *
 * Both surfaces hold the same thing — named, maskable secrets belonging to a
 * remote vendor, one of them the default — and they used to hold it twice: five
 * near-identical component pairs whose only real differences were the secret
 * shape and a couple of extra facts. Everything genuinely shared (the row, its
 * action menu, the create/edit/replace dialogs, delete-with-confirm) lives in
 * this folder once; everything that actually differs arrives through the two
 * modules below.
 *
 * Both surfaces are a TABLE of credentials over a CATALOG of vendors: the page
 * lists what the organization holds, and adding one starts by picking the
 * vendor it belongs to. Only the vendor's one-line summary differs between them
 * (tags and an action count versus a wire format and a model count), so that
 * arrives as a single `vendorMeta` projection rather than a second card
 * component per surface.
 */

export type Translator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** What a credential authenticates against: a connector or an AI provider. */
export interface CredentialVendor {
  /** Slug/name — the mutation argument and the React key. */
  key: string;
  displayName: string;
  /** Served `icon.svg`, when the vendor ships one. */
  iconUrl?: string;
  /**
   * True when each credential names its own instance (an Azure resource, a
   * Confluence site) instead of sharing one fixed vendor host.
   */
  needsEndpoint: boolean;
}

/** The minimum the shared UI needs to know about a stored credential. */
export interface CredentialLike {
  id: string;
  name: string;
  authMethod: string;
  status: string;
  isDefault: boolean;
  endpointUrl?: string;
}

/**
 * Step two of "add a credential" for a vendor whose only auth method is an
 * OAuth grant. There is no form to render — the material comes back from the
 * vendor's consent screen — so the surface supplies its own explainer and
 * hand-off button instead.
 */
export interface CredentialConsentProps<V> {
  organizationId: string;
  vendor: V;
  /** Step back to the vendor picker. */
  onBack: () => void;
  /** Dismiss the whole add flow. */
  onClose: () => void;
}

/**
 * A mutation as the shared UI calls it: loose arguments in, pending flag out.
 *
 * The features' own Convex hooks take precisely-typed arguments (branded
 * `Id<'connectorCredentials'>`, closed auth-method unions), and a function
 * taking a narrow parameter is not assignable to one taking a wide parameter.
 * `looseMutation` is the single, deliberate seam where that is bridged.
 */
export interface LooseMutation {
  mutateAsync: (args: Record<string, unknown>) => Promise<unknown>;
  isPending: boolean;
}

/**
 * Wrap a feature's typed mutation hook result for the shared UI.
 *
 * The cast is sound by construction: every argument object the shared dialogs
 * assemble is built from THIS adapter's own `vendorArg`, `secret.buildArgs` and
 * `extra.*Args`, so the shape is the wrapped mutation's own. Keeping the cast
 * here means it is asserted once, next to that reasoning, instead of at eight
 * call sites.
 */
export function looseMutation<Args>(mutation: {
  mutateAsync: (args: Args) => Promise<unknown>;
  isPending: boolean;
}): LooseMutation {
  return {
    isPending: mutation.isPending,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller assembles every argument from this adapter's own vendorArg/buildArgs/extraArgs, so the shape is this mutation's by construction
    mutateAsync: (args) => mutation.mutateAsync(args as Args),
  };
}

/**
 * The secret half of a credential — the one part whose shape genuinely differs
 * per surface. Connectors carry a token or a username/password pair; providers
 * carry an API key, an env-var name, or a whole broker document.
 */
export interface CredentialSecretModule<Method extends string, Draft> {
  empty: () => Draft;
  /** Whether anything has been typed — drives the discard-on-close prompt. */
  isDirty: (draft: Draft) => boolean;
  /** Whether the method's required fields are filled — the submit gate. */
  isComplete: (method: Method, draft: Draft) => boolean;
  /**
   * The mutation arguments for this method.
   *
   * A Result, not a plain object: the provider broker form validates client-side
   * and can fail, and that failure has to reach the reader as inline dialog
   * copy BEFORE a request goes out. Returning a bare object would force the
   * caller to either throw or send known-bad input. The failure message is
   * user-facing, which is why this takes the translator.
   */
  buildArgs: (
    t: Translator,
    method: Method,
    draft: Draft,
  ) =>
    | { ok: true; args: Record<string, unknown> }
    | { ok: false; message: string };
  /**
   * False when the method has no hand-entered secret at all (an OAuth grant
   * comes back from consent). Such a credential offers no replace-secret
   * action, because there is nothing to replace.
   */
  hasFields: (method: Method) => boolean;
  /**
   * The replace-secret dialog's title for this method, or `null` when this
   * surface has no replacement form for it. `null` also hides the row action,
   * so the two can never disagree.
   */
  replaceTitle: (t: Translator, method: Method) => string | null;
  /** Optional note above the replacement fields (e.g. what an empty field keeps). */
  replaceNote?: (t: Translator, method: Method) => string | undefined;
  Fields: ComponentType<{
    method: Method;
    value: Draft;
    onChange: (next: Draft) => void;
    disabled?: boolean;
    /** True in the replace dialog — lets a method label itself differently there. */
    replacing?: boolean;
  }>;
}

/**
 * Non-secret fields only one surface has (today: the providers' model
 * allowlist). Typed rather than an untyped escape hatch, so the generic dialogs
 * still type-check their own argument building.
 */
export interface CredentialExtraModule<V, Cred, Extra> {
  empty: () => Extra;
  /** Seed the edit dialog from the stored credential. */
  fromCredential: (credential: Cred) => Extra;
  isDirty: (value: Extra, baseline: Extra) => boolean;
  /** Arguments contributed when creating. */
  createArgs: (value: Extra) => Record<string, unknown>;
  /** Arguments contributed when editing — may send `null` to clear a field. */
  editArgs: (value: Extra) => Record<string, unknown>;
  /** Return `null` to render nothing for this vendor. */
  Fields: ComponentType<{
    vendor: V;
    value: Extra;
    onChange: (next: Extra) => void;
    disabled?: boolean;
  }> | null;
}

/**
 * The no-op extra module, for a surface with no extra fields. A factory rather
 * than a shared constant so it types against the caller's own vendor and
 * credential types instead of forcing a cast at the assignment.
 */
export function noExtras<V, Cred>(): CredentialExtraModule<V, Cred, undefined> {
  return {
    empty: () => undefined,
    fromCredential: () => undefined,
    isDirty: () => false,
    createArgs: () => ({}),
    editArgs: () => ({}),
    Fields: null,
  };
}

export interface CredentialAdapter<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
> {
  /** Prefix for `console.error` lines, so operator logs name the surface. */
  logTag: string;
  /** Turns a Convex failure into the message the reader sees. */
  mapError: (err: unknown) => string;
  /** Display label for a raw auth-method string. */
  methodLabel: (t: Translator, method: string) => string;
  /**
   * Narrow a stored credential's raw method string to this surface's own
   * vocabulary, or `null` when it belongs to neither.
   *
   * A runtime check rather than a cast, and it earns its keep: a credential
   * written by a future vendor vocabulary returns `null`, and the row then
   * simply offers no secret replacement instead of rendering a form that
   * cannot possibly submit.
   */
  methodOf: (credential: Cred) => Method | null;
  /**
   * The vendor a stored credential belongs to, as a `CredentialVendor.key`.
   *
   * The table is a flat list of credentials across every vendor, so each row has
   * to find its own icon, display name and catalog facts; this is the join.
   */
  vendorKeyOf: (credential: Cred) => string;
  /** The methods this surface can author for a vendor (excludes OAuth-only). */
  formMethods: (vendor: V) => Method[];
  /**
   * The vendor's one-line summary in the catalog picker — tags and an action
   * count for a connector, the wire format and a model count for a provider.
   */
  vendorMeta: (t: Translator, vendor: V) => ReactNode;
  /**
   * Whether this vendor can be joined by consent rather than by typing a
   * secret. Declared separately from `Consent` because the catalog has to know
   * BEFORE rendering: a vendor with neither a form nor a grant is dropped from
   * the picker, and asking the component would mean rendering it to find out.
   */
  offersConsent?: (vendor: V) => boolean;
  /** The consent hand-off itself, shown for vendors `offersConsent` accepts. */
  Consent?: ComponentType<CredentialConsentProps<V>>;
  /**
   * Badge label for a credential's state, or `null` for the healthy one. A
   * healthy credential needs no marker.
   */
  statusLabel: (t: Translator, status: string) => string | null;
  /** Badge tone for a non-healthy state — attention colour only where a
   *  human has to act. */
  statusTone: (status: string) => 'slate' | 'orange';
  /** Monospace coordinates on the row's second line (masked secret, env name). */
  facts: (credential: Cred) => Array<string | undefined>;
  /** Quiet trailing text on that line (e.g. an allowlist count). */
  factNote?: (t: Translator, credential: Cred) => ReactNode;
  /**
   * A second line under the row's name explaining an unhealthy state and what
   * fixes it.
   *
   * Takes the VENDOR too, because not every such state belongs to the
   * credential: a provider whose model catalog could not be fetched cannot
   * serve a request no matter how healthy the key is, and that used to be a
   * badge on the vendor's card. `null` when the vendor left the catalog.
   */
  detailLine?: (t: Translator, credential: Cred, vendor: V | null) => ReactNode;
  /** Surface-specific row actions, prepended to the shared ones. */
  extraActions?: (context: {
    t: Translator;
    credential: Cred;
    organizationId: string;
    busy: boolean;
  }) => EntityRowAction[];
  /** Copy for the per-credential endpoint field. */
  endpointField: (
    t: Translator,
    vendor: V,
  ) => { label: string; placeholder?: string; description?: string };
  secret: CredentialSecretModule<Method, Draft>;
  extra: CredentialExtraModule<V, Cred, Extra>;
  /** The vendor-identifying create argument: `{connectorSlug}` / `{providerSlug}`. */
  vendorArg: (vendor: V) => Record<string, string>;
  /**
   * The feature's own Convex hooks. Called unconditionally at the top of the
   * shared components, so the adapter must be a stable module-level object.
   */
  mutations: {
    useCreate: () => LooseMutation;
    useUpdate: () => LooseMutation;
    useDelete: () => LooseMutation;
    useSetDefault: () => LooseMutation;
  };
}
