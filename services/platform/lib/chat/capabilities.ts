/**
 * The capability surface — ONE registry and ONE dispatcher for everything a
 * model can call by id.
 *
 * In this version the registry holds the organization's deployed automations
 * (the host registers them; `invoke_capability` on one is the same act as the
 * engine's `run_deployed`). The `kind` discriminant and the exhaustive
 * `switch` with its `never` arm stay, so a second kind cannot ship until
 * someone has decided which backend runs it — a capability is something with
 * a name, a description, an input schema, and a result, whatever the
 * platform calls it.
 *
 * Design decisions worth keeping:
 *
 *  - **Input is always validated, output sometimes is.** Every capability
 *    declares an input schema and the dispatcher enforces it before anything
 *    runs. An output schema is optional: a capability that declares none is
 *    UNSTRUCTURED, and its result is passed through as-is rather than being
 *    forced into a shape nobody promised.
 *  - **Knowledge is a separate method.** `get_knowledge` is not folded into
 *    `search_capabilities` because retrieving facts and finding a tool are
 *    different questions; one returns knowledge, the other returns things to
 *    call, and a merged result list makes the model guess which it got.
 *  - **Memories are a tool with an approval gate.** `memory.save` writes a
 *    PENDING row and an audit entry; `memory.search` reads approved rows only.
 *    Nothing is injected into a prompt automatically — a model cannot give
 *    itself durable state about a person by writing it down.
 *
 * Every method is org-scoped: the registry is bound to one organization at
 * construction and every backend call carries that id.
 *
 * Layer A: pure, no `node:*` — the backends are ports the host fills in.
 */

import { Ajv, type ValidateFunction } from 'ajv';

import { rankFuzzy } from '../engine/api/catalog-search';
import { closestName } from '../engine/core/validate/similar';

const ajv = new Ajv({ allErrors: true, strict: false });

export const CAPABILITY_KINDS = ['automation'] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

interface CapabilityBase {
  /** Stable id the model calls, e.g. `automation.github/triage-issues`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[];
  /** JSON Schema. Enforced before dispatch, always. */
  readonly inputSchema: Record<string, unknown>;
  /** JSON Schema. ABSENT MEANS UNSTRUCTURED — the result is whatever the
   * backend returned, and callers are told so. */
  readonly outputSchema?: Record<string, unknown>;
}

export type Capability = CapabilityBase & {
  readonly kind: 'automation';
  /** The deployed automation's name — what `run_deployed` is given. */
  readonly automation: string;
};

/** A capability with no declared output schema returns whatever its backend
 * returns. Chat is fine with that; an automation that needs typing declares one. */
export function isUnstructured(capability: Capability): boolean {
  return capability.outputSchema === undefined;
}

// ---------------------------------------------------------------- registry

/**
 * The one registry. Bound to an organization, because a capability list is
 * org-owned: an org's automations are not visible to any other org.
 */
export class CapabilityRegistry {
  readonly organizationId: string;
  private readonly byId = new Map<string, Capability>();

  constructor(organizationId: string) {
    this.organizationId = organizationId;
  }

  /** Register one capability. A duplicate id is a packaging defect: two
   * different things answering to one name means the model's call is
   * ambiguous, and silently keeping one of them hides that. */
  register(capability: Capability): this {
    const existing = this.byId.get(capability.id);
    if (existing) {
      throw new Error(
        `[chat] capability id "${capability.id}" is registered twice (${existing.kind} and ${capability.kind})`,
      );
    }
    this.byId.set(capability.id, capability);
    return this;
  }

  registerAll(capabilities: Iterable<Capability>): this {
    for (const capability of capabilities) this.register(capability);
    return this;
  }

  get(id: string): Capability | undefined {
    return this.byId.get(id);
  }

  list(): readonly Capability[] {
    return [...this.byId.values()];
  }

  ids(): readonly string[] {
    return [...this.byId.keys()];
  }
}

// ---------------------------------------------------------------- backends

/** What every backend returns: the output, or a refusal the model can act on. */
export type BackendResult =
  | { readonly status: 'ok'; readonly output: unknown }
  | {
      readonly status: 'refused';
      readonly reason: string;
      readonly hint?: string;
    };

export interface AutomationInvocation {
  readonly organizationId: string;
  readonly userId: string;
  readonly automation: string;
  readonly input: unknown;
}

export interface CapabilityBackends {
  /** Always through the automations store — see
   * {@link createAutomationsBackend}. */
  readonly automation: (
    request: AutomationInvocation,
  ) => Promise<BackendResult>;
}

// -------------------------------------------------------------- knowledge

export interface KnowledgeRequest {
  readonly organizationId: string;
  readonly query: string;
  /** Which corpus to search — private org knowledge or crawled public web.
   * Named for the corpora themselves (`private_knowledge` / `public_web`), so
   * the chat surface, the MCP tool, and the retrieval pipeline all say
   * "corpus" for the same choice. */
  readonly corpus?: 'private' | 'public-web' | 'all';
  /** Passages to return. The retrieval pipeline caps and defaults it. */
  readonly limit?: number;
}

export interface KnowledgePassage {
  readonly text: string;
  /** Human-readable citation — a document title, falling back to the ref. */
  readonly source: string;
  /**
   * The DURABLE identity of the source — the document's file id, or the URL
   * of a crawled page. Distinct from `source` (which prefers the title, a
   * mutable display string): this is what an agent cites by, feeds back into
   * follow-up retrieval, and what the provenance ledger records.
   */
  readonly ref?: string;
  readonly url?: string;
  readonly score?: number;
}

export type KnowledgeResult =
  | { readonly status: 'ok'; readonly passages: readonly KnowledgePassage[] }
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * The retrieval seam: one org-scoped query in, passages out. A backend that
 * cannot run answers `unavailable` with a reason rather than an empty passage
 * list — "the knowledge base is not available" and "your knowledge base
 * contains nothing about this" are different facts, and a result that says
 * the second when it means the first teaches the model to stop asking.
 */
export interface KnowledgeBackend {
  search(request: KnowledgeRequest): Promise<KnowledgeResult>;
}

// ----------------------------------------------------------------- memory

export interface MemoryRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly content: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly createdAt: number;
}

export interface MemorySaveRequest {
  readonly organizationId: string;
  readonly userId: string;
  readonly content: string;
  /** Always `pending`: the surface never offers any other status, so a model
   * cannot write itself an approved memory. */
  readonly status: 'pending';
  readonly sourceThreadId?: string;
  readonly sourceMessageId?: string;
  readonly createdAt: number;
}

export interface MemorySearchRequest {
  readonly organizationId: string;
  readonly userId: string;
  readonly query: string;
  readonly limit?: number;
}

export interface MemoryStore {
  save(request: MemorySaveRequest): Promise<{ id: string }>;
  search(request: MemorySearchRequest): Promise<readonly MemoryRecord[]>;
}

/** One line in the audit trail. A memory is durable state about a person, so
 * proposing one is an auditable act even before anyone approves it. */
export interface CapabilityAuditEntry {
  readonly organizationId: string;
  readonly userId: string;
  readonly action: 'memory.save';
  readonly memoryId: string;
  readonly threadId?: string;
  readonly at: number;
}

export interface CapabilityAuditSink {
  record(entry: CapabilityAuditEntry): Promise<void>;
}

// ---------------------------------------------------------------- results

export interface CapabilitySearchHit {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly description: string;
  /** False when the capability declares no output schema. */
  readonly structured: boolean;
}

export type InvokeResult =
  | {
      readonly status: 'ok';
      readonly id: string;
      readonly kind: CapabilityKind;
      readonly structured: boolean;
      readonly output: unknown;
      /** Set when a declared output schema did not match. The output is still
       * returned — the call already happened, and hiding its result would be
       * worse than reporting the mismatch. */
      readonly schemaViolation?: string;
    }
  | {
      readonly status: 'refused';
      readonly id?: string;
      readonly reason: string;
      readonly hint?: string;
    };

// -------------------------------------------------------------- the surface

export interface CapabilitySurfaceDeps {
  readonly organizationId: string;
  readonly userId: string;
  readonly registry: CapabilityRegistry;
  readonly backends: CapabilityBackends;
  readonly knowledge: KnowledgeBackend;
  readonly memory: MemoryStore;
  readonly audit: CapabilityAuditSink;
  /** The thread the turn belongs to, recorded on saved memories. */
  readonly threadId?: string;
  readonly now?: () => number;
}

export interface SearchCapabilitiesParams {
  readonly query: string;
  readonly limit?: number;
}

export interface InvokeCapabilityParams {
  readonly id: string;
  readonly input?: unknown;
}

export interface GetKnowledgeParams {
  readonly query: string;
  readonly corpus?: KnowledgeRequest['corpus'];
  readonly limit?: number;
}

export interface MemorySaveParams {
  readonly content: string;
  readonly sourceMessageId?: string;
}

export interface MemorySearchParams {
  readonly query: string;
  readonly limit?: number;
}

export type MemorySaveResult =
  | { readonly status: 'pending'; readonly id: string; readonly note: string }
  | { readonly status: 'refused'; readonly reason: string };

/** The method names the surface answers to. The same table is what the
 * platform MCP endpoint exposes, so a harness turn and a chat model reach the
 * identical capability set. */
export const CAPABILITY_METHODS = [
  'search_capabilities',
  'invoke_capability',
  'get_knowledge',
  'memory.save',
  'memory.search',
] as const;

export type CapabilityMethod = (typeof CAPABILITY_METHODS)[number];

export interface CapabilitySurface {
  searchCapabilities(
    params: SearchCapabilitiesParams,
  ): readonly CapabilitySearchHit[];
  invokeCapability(params: InvokeCapabilityParams): Promise<InvokeResult>;
  getKnowledge(params: GetKnowledgeParams): Promise<KnowledgeResult>;
  saveMemory(params: MemorySaveParams): Promise<MemorySaveResult>;
  searchMemories(params: MemorySearchParams): Promise<readonly MemoryRecord[]>;
  /** One entry point for the JSON-RPC and MCP faces. */
  dispatch(method: string, params: unknown): Promise<unknown>;
}

/** Compiled input validators, keyed by the schema object so a re-registered
 * capability with the same schema object never recompiles. */
const validators = new WeakMap<object, ValidateFunction>();

function validatorFor(schema: Record<string, unknown>): ValidateFunction {
  const existing = validators.get(schema);
  if (existing) return existing;
  const compiled = ajv.compile(schema);
  validators.set(schema, compiled);
  return compiled;
}

function describeErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((error) =>
      `${error.instancePath || '/'} ${error.message ?? ''}`.trim(),
    )
    .join('; ');
}

function refuse(reason: string, hint?: string, id?: string): InvokeResult {
  return { status: 'refused', reason, hint, id };
}

/** What a search result tells the model: what it is and whether its result
 * is typed. */
function toSearchHit(capability: Capability): CapabilitySearchHit {
  return {
    id: capability.id,
    kind: capability.kind,
    name: capability.name,
    description: capability.description,
    structured: !isUnstructured(capability),
  };
}

export function createCapabilitySurface(
  deps: CapabilitySurfaceDeps,
): CapabilitySurface {
  if (deps.registry.organizationId !== deps.organizationId) {
    throw new Error(
      '[chat] capability registry belongs to a different organization than the surface',
    );
  }
  const now = deps.now ?? (() => Date.now());
  const { organizationId, userId, registry, backends } = deps;

  /**
   * Run one capability against its backend. THE exhaustive switch: each kind
   * names exactly one backend, and the `never` arm means a new kind cannot be
   * added without deciding where it runs.
   */
  const runBackend = async (
    capability: Capability,
    input: unknown,
  ): Promise<BackendResult> => {
    switch (capability.kind) {
      case 'automation':
        return backends.automation({
          organizationId,
          userId,
          automation: capability.automation,
          input,
        });
      default: {
        const exhaustive: never = capability.kind;
        throw new Error(
          `[chat] no backend for capability kind: ${String(exhaustive)}`,
        );
      }
    }
  };

  const searchCapabilities = (
    params: SearchCapabilitiesParams,
  ): readonly CapabilitySearchHit[] =>
    rankFuzzy(
      params.query,
      registry.list(),
      (capability) => ({
        name: capability.id,
        body: `${capability.name} ${capability.description} ${(capability.tags ?? []).join(' ')}`,
      }),
      params.limit ?? 8,
    ).map(toSearchHit);

  const invokeCapability = async (
    params: InvokeCapabilityParams,
  ): Promise<InvokeResult> => {
    const capability = registry.get(params.id);
    if (!capability) {
      const suggestion = closestName(params.id, registry.ids());
      return refuse(
        `No capability "${params.id}".`,
        suggestion
          ? `Did you mean "${suggestion}"?`
          : 'Call search_capabilities to find what this organization actually has.',
        params.id,
      );
    }

    const input = params.input ?? {};
    const validate = validatorFor(capability.inputSchema);
    if (!validate(input)) {
      return refuse(
        `Input does not match the schema of "${capability.id}": ${describeErrors(validate)}`,
        'Fix the arguments and call again.',
        capability.id,
      );
    }

    const result = await runBackend(capability, input);
    if (result.status === 'refused') {
      return refuse(result.reason, result.hint, capability.id);
    }

    const structured = !isUnstructured(capability);
    let schemaViolation: string | undefined;
    if (capability.outputSchema) {
      const validateOutput = validatorFor(capability.outputSchema);
      if (!validateOutput(result.output)) {
        schemaViolation = describeErrors(validateOutput);
      }
    }

    return {
      status: 'ok',
      id: capability.id,
      kind: capability.kind,
      structured,
      output: result.output,
      ...(schemaViolation ? { schemaViolation } : {}),
    };
  };

  const getKnowledge = async (
    params: GetKnowledgeParams,
  ): Promise<KnowledgeResult> =>
    deps.knowledge.search({
      organizationId,
      query: params.query,
      corpus: params.corpus,
      limit: params.limit,
    });

  const saveMemory = async (
    params: MemorySaveParams,
  ): Promise<MemorySaveResult> => {
    const content = params.content.trim();
    if (content.length === 0) {
      return { status: 'refused', reason: 'A memory cannot be empty.' };
    }
    const at = now();
    const { id } = await deps.memory.save({
      organizationId,
      userId,
      content,
      status: 'pending',
      sourceThreadId: deps.threadId,
      sourceMessageId: params.sourceMessageId,
      createdAt: at,
    });
    await deps.audit.record({
      organizationId,
      userId,
      action: 'memory.save',
      memoryId: id,
      threadId: deps.threadId,
      at,
    });
    return {
      status: 'pending',
      id,
      note: 'Saved as pending. It becomes usable only once the user approves it, and nothing is added to this conversation automatically.',
    };
  };

  const searchMemories = async (
    params: MemorySearchParams,
  ): Promise<readonly MemoryRecord[]> => {
    const found = await deps.memory.search({
      organizationId,
      userId,
      query: params.query,
      limit: params.limit,
    });
    // Filtered here as well as in the store: "approved only" is the rule this
    // surface promises, and it must not depend on every store implementation
    // remembering it.
    return found.filter(
      (memory) =>
        memory.status === 'approved' &&
        memory.organizationId === organizationId &&
        memory.userId === userId,
    );
  };

  const asObject = (params: unknown): Record<string, unknown> =>
    params !== null && typeof params === 'object' && !Array.isArray(params)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
        (params as Record<string, unknown>)
      : {};

  const asString = (value: unknown): string =>
    typeof value === 'string' ? value : '';

  const dispatch = async (
    method: string,
    params: unknown,
  ): Promise<unknown> => {
    const p = asObject(params);
    const knownMethod = (CAPABILITY_METHODS as readonly string[]).includes(
      method,
    )
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by the membership check above
        (method as CapabilityMethod)
      : undefined;
    if (!knownMethod) {
      return {
        error: `unknown method "${method}"`,
        hint: `available methods: ${CAPABILITY_METHODS.join(', ')}`,
      };
    }
    switch (knownMethod) {
      case 'search_capabilities':
        return {
          capabilities: searchCapabilities({
            query: asString(p.query),
            limit: typeof p.limit === 'number' ? p.limit : undefined,
          }),
        };
      case 'invoke_capability':
        return invokeCapability({ id: asString(p.id), input: p.input });
      case 'get_knowledge':
        return getKnowledge({
          query: asString(p.query),
          corpus:
            p.corpus === 'private' ||
            p.corpus === 'public-web' ||
            p.corpus === 'all'
              ? p.corpus
              : undefined,
          limit: typeof p.limit === 'number' ? p.limit : undefined,
        });
      case 'memory.save':
        return saveMemory({
          content: asString(p.content),
          sourceMessageId:
            typeof p.sourceMessageId === 'string'
              ? p.sourceMessageId
              : undefined,
        });
      case 'memory.search':
        return {
          memories: await searchMemories({
            query: asString(p.query),
            limit: typeof p.limit === 'number' ? p.limit : undefined,
          }),
        };
      default: {
        const exhaustive: never = knownMethod;
        throw new Error(
          `[chat] unhandled capability method: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  };

  return {
    searchCapabilities,
    invokeCapability,
    getKnowledge,
    saveMemory,
    searchMemories,
    dispatch,
  };
}
