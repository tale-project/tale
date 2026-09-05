/**
 * `executeConnectorAction` — the ONE way any part of the platform invokes a
 * connector action.
 *
 * Automation nodes, chat tools, conversation email replies, and actionable
 * notifications all arrive here, so the rules that make a connector call
 * safe are written once: the action's JSON Schema is enforced before anything
 * leaves the process, live traffic is mediated by the host (allowlist,
 * https-only, host-owned Authorization), and the caller mode decides what
 * approval and audit obligations apply. A caller that reaches a vendor API by
 * some other route is bypassing all of that, which is exactly what this module
 * exists to make unnecessary.
 *
 * Two axes, kept separate on purpose:
 *
 *  - **mode** — `mock` runs the action's deterministic mock body and performs
 *    no IO whatsoever; `live` runs the declared backend. The authoring loop
 *    lives on `mock`, so it is the default: nothing reaches the outside world
 *    unless a caller asks for it AND the credentials, host, and backend are
 *    all genuinely available.
 *  - **caller** — who is asking, which decides approval gating and audit
 *    obligations (see {@link callerPolicy}).
 *
 * Everything the platform owns is injected: the credential resolver, the
 * approval gate, the audit sink, and the blob sink. This module therefore
 * knows nothing about Convex and can be exercised end to end in tests; the
 * Convex surface under `convex/connectors/` is the thin wiring that supplies
 * the real implementations.
 *
 * The module is node-side by construction — it loads the shipped catalog
 * through the connector registry, which reads the filesystem.
 */

import { Ajv, type ValidateFunction } from 'ajv';

import { stableStringify } from '../engine/api/tests';
import { codeRunner, type CodeRunner } from '../engine/core/runner';
import type { ConnectorContext } from '../engine/core/slots';
import { closestName } from '../engine/core/validate/similar';
import type {
  ConnectorAction,
  Connector,
  ConnectorEffect,
} from '../shared/schemas/connectors';
import { ConnectorError } from './errors';
import {
  createLiveHost,
  type ConnectorBlobSink,
  type LiveHostOptions,
} from './live-host';
import {
  buildPortableLiveCode,
  type PortableHostCall,
  type PortableLiveCtxData,
} from './portable-live';
import { loadConnectors, nodeTypeFor } from './registry';

const ajv = new Ajv({ allErrors: true, strict: false });

/** Mock bodies reshape data; the ceiling only bounds a runaway loop. */
const MOCK_TIMEOUT_MS = 2000;

/** A live body may chain several vendor calls, each individually capped by the
 * host, so its own ceiling is generous. */
const DEFAULT_LIVE_TIMEOUT_MS = 60_000;

// ------------------------------------------------------------------ catalog

const catalog = new Map<string, Connector>();

/**
 * Install the connector catalog the dispatcher resolves against. Hosts call
 * this once at assembly time; passing a fresh set replaces the previous one so
 * a config reload cannot leave a half-updated catalog behind.
 */
export function installConnectorCatalog(
  connectors: readonly Connector[],
): void {
  catalog.clear();
  for (const connector of connectors) catalog.set(connector.name, connector);
}

/**
 * Load every shipped connector under `<systemRoot>/connectors/`, register
 * its actions as engine node types, and install the result as the dispatch
 * catalog — one read of the catalog serving both the engine and the
 * dispatcher, so the two can never disagree about which actions exist.
 */
export function loadConnectorCatalog(systemRoot: string): Connector[] {
  const { connectors } = loadConnectors(systemRoot);
  installConnectorCatalog(connectors);
  return connectors;
}

// ----------------------------------------------------------- native backends

/**
 * What a `native` backend receives. It is the same mediated context a
 * `yaml-js` body gets, plus the identifiers a platform module legitimately
 * needs: native modules speak protocols HTTP cannot express (IMAP/SMTP,
 * WebDAV) and act against org-owned storage, so they are trusted code — but
 * they are still handed the org they act for rather than discovering it.
 */
export interface NativeConnectorContext extends ConnectorContext {
  organizationId: string;
  credentialId: string;
  authMethod: string;
  /** Who asked — a platform capability that acts on the caller's own scope
   * (the sandbox script runner binding to its workflow run's session) reads
   * it; vendor-facing natives ignore it. Optional so their tests need not
   * fabricate one. */
  caller?: ConnectorCaller;
}

export type NativeConnectorImpl = (
  input: unknown,
  ctx: NativeConnectorContext,
) => Promise<unknown>;

const natives = new Map<string, NativeConnectorImpl>();

/**
 * Register a native backend under the id its connector declares
 * (`imap-smtp.send`, `webdav.list_files`). Returns a disposer so a host — or a
 * test — can take it back out again; nothing else can unregister an impl by
 * accident.
 */
export function registerNativeImpl(
  id: string,
  impl: NativeConnectorImpl,
): () => void {
  natives.set(id, impl);
  return () => {
    if (natives.get(id) === impl) natives.delete(id);
  };
}

/** The registered native backend ids — what the "not available" error lists. */
export function nativeImplIds(): string[] {
  return [...natives.keys()].sort();
}

// -------------------------------------------------------------- injected seams

/**
 * The credential lookup, injected. The credentials domain owns decryption,
 * OAuth refresh, and building the Authorization header for the credential's
 * auth method; the dispatcher only asks for the org's credential and hands
 * what comes back to the host.
 */
export interface CredentialResolver {
  resolve(
    orgId: string,
    connectorSlug: string,
    ref?: string,
  ): Promise<ResolvedCredential>;
}

export interface ResolvedCredential {
  credentialId: string;
  authMethod: string;
  /** Values a live body places itself, reached through `ctx.secrets`. Tokens
   * the platform injects as Authorization must NOT appear here. */
  secrets: Record<string, string>;
  /** The credential's API origin for a `per-credential` connector. */
  endpoint?: string;
  /** The connector's non-secret per-credential settings, reached through
   * `ctx.config`. Empty when the connector declares none. */
  config?: Record<string, string | number | boolean>;
  /** Pre-built Authorization header; absent for `api-key` connectors. */
  authHeader?: string;
}

export type ApprovalDecision =
  | { status: 'allowed' }
  | { status: 'required'; approvalId?: string; message?: string };

/** The approvals policy, injected — it lives in the governance domain. */
export interface ApprovalGate {
  check(request: {
    organizationId: string;
    userId: string;
    connector: string;
    action: string;
    input: unknown;
    /** The operation's stable identity, so a decision the gate already recorded
     * (a human's approval of THIS operation) is honoured when the same call is
     * retried, instead of prompting again. Derived by the dispatcher, so the
     * gate never has to reconstruct it. */
    idempotencyKey: string;
    /** Whether the write stays inside the tenant's own platform surface — a
     * `platform`-auth connector. The dispatcher knows it from the connector it
     * already resolved; the policy needs it to tell an internal write from one
     * leaving the tenant. */
    platformInternal: boolean;
  }): Promise<ApprovalDecision>;
}

/** One invocation as the audit trail sees it. */
export interface ConnectorInvocationRecord {
  organizationId: string;
  connector: string;
  action: string;
  /** `<connector>.<action>` — how the engine and the catalog address it. */
  nodeType: string;
  effects: ConnectorEffect;
  mode: ConnectorMode;
  callerKind: ConnectorCaller['kind'];
  /** Who or what asked: a user id, an automation run, or a system reason. */
  callerRef: string;
  /** Why approvals were skipped. Always present for the `system` caller. */
  reason?: string;
  credentialId?: string;
  idempotencyKey: string;
  outcome: 'ok' | 'error' | 'approval-required';
  error?: string;
}

export interface ConnectorAuditSink {
  record(entry: ConnectorInvocationRecord): Promise<void>;
}

/** How the mediated capabilities are built. Injectable so a host can supply a
 * different transport (a sandbox-side proxy, a test double) without the
 * dispatcher learning about it. */
export type ConnectorHostFactory = (
  options: LiveHostOptions,
) => ReturnType<typeof createLiveHost>;

// ------------------------------------------------------------------- callers

/**
 * Who is invoking, and what that implies. Every mode is spelled out because
 * the differences are policy, not convenience:
 *
 *  - `user` — a person asked, through chat or the UI. A `write` action gates
 *    behind the org's approvals policy; the gate is REQUIRED for those calls,
 *    so a host that forgot to wire it refuses the write instead of quietly
 *    performing it.
 *  - `system` — the platform acting on its own behalf: a conversation email
 *    reply, an actionable notification. It skips approvals DELIBERATELY —
 *    there is no human in the loop to approve — which is exactly why every
 *    such call states a reason and is recorded. Without an audit sink the call
 *    is refused: an unrecorded approval bypass is precisely the thing this
 *    mode exists to eliminate, since these senders previously reached their
 *    vendors without passing through the connector layer at all.
 *  - `workflow` — the engine executing a node. Approvals and effect recording
 *    happen in the executor, which sees the whole run and gates before the
 *    node ever reaches the dispatcher; re-gating here would double-prompt.
 */
export type ConnectorCaller =
  | { kind: 'user'; userId: string }
  | { kind: 'system'; reason: string }
  | { kind: 'workflow'; runId: string; nodeId: string };

interface CallerPolicy {
  /** Whether a `write` action must clear the approvals gate here. */
  gateApprovals: boolean;
  /** Whether the invocation MUST be recorded for the call to be allowed. */
  mustRecord: boolean;
  /** Why approvals were skipped, when they were skipped on purpose. */
  reason?: string;
  /** The caller's identity for the audit trail. */
  ref: string;
}

function callerPolicy(caller: ConnectorCaller): CallerPolicy {
  switch (caller.kind) {
    case 'user':
      return { gateApprovals: true, mustRecord: false, ref: caller.userId };
    case 'system':
      return {
        gateApprovals: false,
        mustRecord: true,
        reason: caller.reason,
        ref: `system:${caller.reason}`,
      };
    case 'workflow':
      return {
        gateApprovals: false,
        mustRecord: false,
        ref: `${caller.runId}/${caller.nodeId}`,
      };
    default: {
      // Exhaustiveness: adding a caller mode without deciding its approval and
      // audit obligations must not compile.
      const exhaustive: never = caller;
      throw new ConnectorError(
        'CALLER_UNKNOWN',
        `unknown caller mode: ${JSON.stringify(exhaustive)}`,
        { hint: 'callers are user | system | workflow' },
      );
    }
  }
}

// -------------------------------------------------------------------- dispatch

export type ConnectorMode = 'mock' | 'live';

export interface ConnectorDispatchContext {
  /** Every path is org-scoped: credentials, blobs, and the audit trail all
   * key on it. */
  organizationId: string;
  /** Defaults to `mock` — reaching the outside world is always explicit. */
  mode?: ConnectorMode;
  credentials?: CredentialResolver;
  approvals?: ApprovalGate;
  audit?: ConnectorAuditSink;
  /** Supplying a sink is what gives a live body `ctx.files`. */
  blobs?: ConnectorBlobSink;
  /**
   * Stable across retries of one logical attempt, so a re-run cannot
   * double-send. Callers with a natural attempt identity (an automation run and
   * node, a queued job) pass theirs; otherwise one is derived from the call
   * itself, which is stable for an identical retry.
   */
  idempotencyKey?: string;
  /** Ceiling for one live body, including the vendor calls it chains. */
  timeoutMs?: number;
  hostFactory?: ConnectorHostFactory;
  /**
   * Per-invocation CodeRunner override for the LIVE yaml-js path. A caller
   * with a sandbox session hands in the session-bound out-of-process runner
   * here — never through the process-global `setCodeRunner` slot, which two
   * concurrent orgs share. Mock bodies always run on the global runner (pure,
   * data-only, no host).
   */
  codeRunner?: CodeRunner;
  /**
   * Where the PORTABLE live convention's in-sandbox façade calls back to, and
   * as whom (a one-run capability token). Required when `codeRunner` is the
   * sandbox-exec backend: the body runs out of process and its `ctx.http`
   * round-trips here so the mediation layer stays server-side.
   */
  portableHost?: PortableHostCall;
}

/** The dispatcher's public call signature. @public */
export interface ExecuteConnectorActionArgs {
  connector: string;
  action: string;
  input: unknown;
  /** Which stored credential to act as; omitted selects the org default. */
  credentialRef?: string;
  caller: ConnectorCaller;
  ctx: ConnectorDispatchContext;
}

/** The dispatcher's public result union. @public */
export type ConnectorDispatchResult =
  | {
      status: 'ok';
      connector: string;
      action: string;
      nodeType: string;
      mode: ConnectorMode;
      /** Which body actually ran — never inferred by the caller. */
      backend: 'mock' | 'yaml-js' | 'native';
      effects: ConnectorEffect;
      output: unknown;
      credentialId?: string;
    }
  | {
      status: 'approval-required';
      connector: string;
      action: string;
      nodeType: string;
      approvalId?: string;
      message: string;
    };

/** Compiled input validators, keyed by the schema object itself so a catalog
 * reload compiles fresh ones and an unchanged action never recompiles. */
const validators = new WeakMap<object, ValidateFunction>();

function validatorFor(action: ConnectorAction): ValidateFunction {
  const existing = validators.get(action.input);
  if (existing) return existing;
  const compiled = ajv.compile(action.input);
  validators.set(action.input, compiled);
  return compiled;
}

/**
 * The values an `enum` violation would have accepted, appended to Ajv's own
 * sentence. Ajv says "must be equal to one of the allowed values" and then
 * does not say which — leaving the one question the caller actually has
 * unanswered. Every other keyword renders as-is.
 */
function allowedValues(error: { keyword: string; params?: unknown }): string {
  if (error.keyword !== 'enum') return '';
  const params: unknown = error.params;
  const allowed =
    typeof params === 'object' && params !== null && 'allowedValues' in params
      ? params.allowedValues
      : undefined;
  return Array.isArray(allowed) ? ` (${allowed.join(', ')})` : '';
}

/** FNV-1a over the canonical call — same call, same key, no crypto import so
 * the derivation runs anywhere the dispatcher does. */
function derivedIdempotencyKey(
  organizationId: string,
  nodeType: string,
  credentialRef: string | undefined,
  input: unknown,
): string {
  const canonical = stableStringify({
    organizationId,
    nodeType,
    credentialRef: credentialRef ?? null,
    input,
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${nodeType}:${hash.toString(16).padStart(8, '0')}`;
}

function resolveConnector(slug: string): Connector {
  if (catalog.size === 0) {
    throw new ConnectorError(
      'CATALOG_UNAVAILABLE',
      'no connector catalog is installed',
      {
        connector: slug,
        hint: 'call loadConnectorCatalog(dir) (or installConnectorCatalog) during host assembly',
      },
    );
  }
  const connector = catalog.get(slug);
  if (!connector) {
    const suggestion = closestName(slug, catalog.keys());
    throw new ConnectorError(
      'UNKNOWN_CONNECTOR',
      `no connector "${slug}" in the catalog`,
      {
        connector: slug,
        hint: suggestion
          ? `did you mean "${suggestion}"?`
          : `available connectors: ${[...catalog.keys()].join(', ')}`,
      },
    );
  }
  return connector;
}

function resolveAction(connector: Connector, name: string): ConnectorAction {
  const action = connector.actions.find((a) => a.name === name);
  if (!action) {
    const names = connector.actions.map((a) => a.name);
    const suggestion = closestName(name, names);
    throw new ConnectorError(
      'UNKNOWN_ACTION',
      `connector "${connector.name}" has no action "${name}"`,
      {
        connector: connector.name,
        action: name,
        hint: suggestion
          ? `did you mean "${suggestion}"?`
          : `available actions: ${names.join(', ')}`,
      },
    );
  }
  return action;
}

/**
 * Invoke one connector action. Resolution and input validation happen before
 * any side effect; on failure the rejection is an {@link ConnectorError}
 * carrying the connector, the action, and what to do next.
 */
export async function executeConnectorAction(
  args: ExecuteConnectorActionArgs,
): Promise<ConnectorDispatchResult> {
  const { input, credentialRef, caller, ctx } = args;
  const mode: ConnectorMode = ctx.mode ?? 'mock';

  if (!ctx.organizationId) {
    throw new ConnectorError(
      'ORGANIZATION_REQUIRED',
      'a connector invocation must name the organization it acts for',
      { connector: args.connector, action: args.action },
    );
  }

  const connector = resolveConnector(args.connector);
  const action = resolveAction(connector, args.action);
  const nodeType = nodeTypeFor(connector.name, action.name);
  const where = { connector: connector.name, action: action.name };
  const policy = callerPolicy(caller);

  if (policy.mustRecord && !policy.reason?.trim()) {
    throw new ConnectorError(
      'SYSTEM_REASON_REQUIRED',
      'a system-caller invocation must state why it runs without approval',
      {
        ...where,
        hint: 'pass caller: { kind: "system", reason: "conversation email reply" }',
      },
    );
  }
  if (policy.mustRecord && !ctx.audit) {
    throw new ConnectorError(
      'AUDIT_SINK_MISSING',
      'the system caller skips approvals and therefore must be recorded, but no audit sink was supplied',
      {
        ...where,
        hint: 'pass ctx.audit — an unrecorded approval bypass is not allowed',
      },
    );
  }

  // Contract first: a call that cannot possibly be correct never reaches a
  // credential, a network socket, or an approval prompt.
  const check = validatorFor(action);
  if (!check(input)) {
    const detail = (check.errors ?? [])
      .map((e) => `input${e.instancePath} ${e.message}${allowedValues(e)}`)
      .join('; ');
    throw new ConnectorError(
      'INPUT_INVALID',
      `input does not match the ${nodeType} schema: ${detail}`,
      {
        ...where,
        hint: `you passed: ${JSON.stringify(input)?.slice(0, 300)}`,
      },
    );
  }

  const idempotencyKey =
    ctx.idempotencyKey ??
    derivedIdempotencyKey(ctx.organizationId, nodeType, credentialRef, input);

  const baseRecord = {
    organizationId: ctx.organizationId,
    connector: connector.name,
    action: action.name,
    nodeType,
    effects: action.effects,
    mode,
    callerKind: caller.kind,
    callerRef: policy.ref,
    ...(policy.reason !== undefined && { reason: policy.reason }),
    idempotencyKey,
  };

  /**
   * Record the invocation. A sink failure is fatal only when the record was
   * mandatory — the system caller's whole justification is that it leaves a
   * trail — and the message then says the action DID run, so an operator is
   * never told a send failed when it succeeded.
   */
  const record = async (
    outcome: ConnectorInvocationRecord['outcome'],
    extras: { credentialId?: string; error?: string },
  ): Promise<void> => {
    if (!ctx.audit) return;
    try {
      await ctx.audit.record({ ...baseRecord, ...extras, outcome });
    } catch (cause) {
      if (policy.mustRecord) {
        throw new ConnectorError(
          'AUDIT_FAILED',
          `${nodeType} ran (${outcome}) but the invocation could not be recorded`,
          { ...where, cause },
        );
      }
      console.warn(
        `[connectors] ${nodeType}: audit record failed (${outcome})`,
        cause,
      );
    }
  };

  if (mode === 'mock') {
    // Deterministic, no IO of any kind: no credential is resolved, no host is
    // built, and the body runs against `input` alone.
    let output: unknown;
    try {
      output = await codeRunner().runBody(
        action.mock,
        { input },
        { timeoutMs: MOCK_TIMEOUT_MS },
      );
    } catch (cause) {
      await record('error', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new ConnectorError(
        'MOCK_BODY_FAILED',
        `the ${nodeType} mock body failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        { ...where, cause },
      );
    }
    await record('ok', {});
    return {
      status: 'ok',
      connector: connector.name,
      action: action.name,
      nodeType,
      mode,
      backend: 'mock',
      effects: action.effects,
      output,
    };
  }

  const backend = action.backend;
  if (!backend) {
    throw new ConnectorError(
      'NO_LIVE_BACKEND',
      `${nodeType} is mock-only — it declares no live backend`,
      {
        ...where,
        hint: 'run it in mock mode, or give the action a yaml-js or native backend',
      },
    );
  }

  // A declared-but-unregistered native backend is a wiring gap, not a reason
  // to fall back to the mock: a caller that asked for a real send must never
  // receive a fabricated success.
  const nativeImpl =
    backend.kind === 'native' ? natives.get(backend.impl) : undefined;
  if (backend.kind === 'native' && !nativeImpl) {
    throw new ConnectorError(
      'NATIVE_IMPL_UNAVAILABLE',
      `${nodeType} runs on the native backend "${backend.impl}", which is not available in this deployment`,
      {
        ...where,
        hint: `registered native backends: ${nativeImplIds().join(', ') || '(none)'}`,
      },
    );
  }

  // A yaml-js LIVE body needs a runner that can carry host capabilities
  // (`ctx.secrets.get`, the HTTP host). The caller-injected sandbox-exec
  // runner does it via the PORTABLE convention (data ctx + host-call façade,
  // and it needs the host-call endpoint to point at); the bundled node-vm
  // backend is data-only — functions never cross its JSON boundary — so
  // running the body there would die inside vendor code with a bare
  // TypeError. Refuse up front with the real reason instead of pretending.
  const liveRunner = ctx.codeRunner ?? codeRunner();
  const runsPortable =
    backend.kind === 'yaml-js' && liveRunner.kind() === 'sandbox-exec';
  if (runsPortable && ctx.portableHost === undefined) {
    throw new ConnectorError(
      'LIVE_RUNNER_UNAVAILABLE',
      `${nodeType} would run out of process, but no host-call endpoint was supplied for its ctx.http to reach back through`,
      {
        ...where,
        hint: 'pass ctx.portableHost (url + one-run token) alongside the sandbox-exec runner',
      },
    );
  }
  if (backend.kind === 'yaml-js' && liveRunner.kind() === 'node-vm') {
    throw new ConnectorError(
      'LIVE_RUNNER_UNAVAILABLE',
      `${nodeType} has a live body, but this deployment's code runner is the data-only node-vm one, which cannot reach credentials or the network`,
      {
        ...where,
        hint: 'live yaml-js execution needs the isolated sandbox runner, which is not wired up yet — run the action in mock mode until it lands',
      },
    );
  }

  // A platform connector authenticates as the platform itself — there is no
  // vendor credential to resolve or store, so the credential gate below is
  // skipped and the backend receives a synthetic identity. The schema refuses
  // `platform` alongside any other method, so this is all-or-nothing — which
  // also makes it the honest answer to "does this write leave the tenant?",
  // read by the approvals policy just below.
  const platformAuth = connector.auth.some(
    (method) => method.method === 'platform',
  );

  if (policy.gateApprovals && action.effects === 'write') {
    if (!ctx.approvals) {
      throw new ConnectorError(
        'APPROVAL_GATE_MISSING',
        `${nodeType} changes the outside world and was requested by a user, but no approvals gate was supplied`,
        {
          ...where,
          hint: 'pass ctx.approvals for user-initiated calls, or invoke with the workflow/system caller that owns its own gating',
        },
      );
    }
    const decision = await ctx.approvals.check({
      organizationId: ctx.organizationId,
      userId: caller.kind === 'user' ? caller.userId : '',
      connector: connector.name,
      action: action.name,
      input,
      idempotencyKey,
      platformInternal: platformAuth,
    });
    if (decision.status === 'required') {
      await record('approval-required', {});
      return {
        status: 'approval-required',
        connector: connector.name,
        action: action.name,
        nodeType,
        ...(decision.approvalId !== undefined && {
          approvalId: decision.approvalId,
        }),
        message:
          decision.message ??
          `${nodeType} needs approval before it can run for this organization`,
      };
    }
  }

  let credential: ResolvedCredential;
  if (platformAuth) {
    credential = {
      credentialId: 'platform',
      authMethod: 'platform',
      secrets: {},
    };
  } else {
    if (!ctx.credentials) {
      throw new ConnectorError(
        'CREDENTIAL_RESOLVER_MISSING',
        `a live ${nodeType} call needs a credential resolver`,
        {
          ...where,
          hint: 'pass ctx.credentials — the Convex surface wires the credentials domain',
        },
      );
    }
    try {
      credential = await ctx.credentials.resolve(
        ctx.organizationId,
        connector.name,
        credentialRef,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await record('error', { error: message });
      throw new ConnectorError(
        'CREDENTIAL_UNRESOLVED',
        `no usable credential for ${connector.name}: ${message}`,
        {
          ...where,
          cause,
          hint: credentialRef
            ? `credential "${credentialRef}" — check it exists for this organization and is active`
            : 'connect the connector, or mark one of its credentials as the default',
        },
      );
    }
  }

  const buildHost = ctx.hostFactory ?? createLiveHost;

  let output: unknown;
  try {
    if (runsPortable && backend.kind === 'yaml-js') {
      // PORTABLE path: the body runs out of process, so `ctx` crosses as
      // data and the prelude rebuilds the façade in the sandbox. No host is
      // built here — every `ctx.http` call round-trips to the host-call
      // endpoint, where the ONE live-host implementation mediates it.
      const portableCtx: PortableLiveCtxData = {
        secrets: credential.secrets,
        config: credential.config ?? {},
        ...(credential.endpoint !== undefined && {
          endpoint: credential.endpoint,
        }),
        idempotencyKey,
        // Checked non-undefined by the LIVE_RUNNER_UNAVAILABLE gate above.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        hostCall: ctx.portableHost!,
      };
      output = await liveRunner.runBody(
        buildPortableLiveCode(backend.live),
        { input, ctx: portableCtx },
        { timeoutMs: ctx.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS },
        { async: true },
      );
    } else {
      // IN-PROCESS path (native backends always; yaml-js under a
      // host-capable in-process runner). Building the host is itself
      // policed — a credential pointing outside the connector's allowlist is
      // refused here — so it shares the block whose failures are recorded.
      const host = buildHost({
        connector,
        action: action.name,
        ...(credential.endpoint !== undefined && {
          endpoint: credential.endpoint,
        }),
        ...(credential.config !== undefined && { config: credential.config }),
        ...(credential.authHeader !== undefined && {
          authHeader: credential.authHeader,
        }),
        ...(ctx.blobs !== undefined && { blobs: ctx.blobs }),
      });

      const connectorCtx: ConnectorContext = {
        secrets: { get: (name: string) => credential.secrets[name] ?? '' },
        idempotencyKey,
        ...host,
      };

      if (nativeImpl) {
        output = await nativeImpl(input, {
          ...connectorCtx,
          organizationId: ctx.organizationId,
          credentialId: credential.credentialId,
          authMethod: credential.authMethod,
          caller,
        });
      } else if (backend.kind === 'yaml-js') {
        output = await liveRunner.runBody(
          backend.live,
          { input, ctx: connectorCtx },
          { timeoutMs: ctx.timeoutMs ?? DEFAULT_LIVE_TIMEOUT_MS },
          { async: true },
        );
      }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await record('error', {
      credentialId: credential.credentialId,
      error: message,
    });
    if (cause instanceof ConnectorError) throw cause;
    throw new ConnectorError(
      'LIVE_BODY_FAILED',
      `the live ${nodeType} call failed: ${message.slice(0, 300)}`,
      {
        ...where,
        cause,
        // A data-only runner backend cannot hand a body the host functions, so
        // this is the one failure whose cause is the deployment, not the call.
        hint: /ctx\.\w+ is not a function|Cannot read propert(?:y|ies) '\w+' of undefined/.test(
          message,
        )
          ? `the CodeRunner backend for this run (${liveRunner.kind()}) may not be able to pass host capabilities into a live body — a live-capable sandbox backend is required`
          : undefined,
      },
    );
  }

  await record('ok', { credentialId: credential.credentialId });
  return {
    status: 'ok',
    connector: connector.name,
    action: action.name,
    nodeType,
    mode,
    backend: backend.kind,
    effects: action.effects,
    output,
    credentialId: credential.credentialId,
  };
}
