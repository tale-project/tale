/**
 * Dependency-inversion seams for the core.
 *
 * Core validates and executes against a node-type table, an automation store
 * (for subautomation nodes), and a language-model service — but core must not
 * import the layers that provide them. Providers register here at assembly
 * time; the host's entry module wires everything, so importing the public
 * API yields a fully assembled engine while the dependency graph stays
 * acyclic. The CodeRunner seam lives in `runner.ts`, re-exported here so
 * hosts assemble against one module.
 */

export { setCodeRunner } from './runner';

// --------------------------------------------------------------- node types

/**
 * The connector surface the core needs. A capability is DECLARED data plus
 * two behaviors: a deterministic mock (required — the fast feedback loop is
 * the product) and an optional live implementation the host gates.
 */
export interface IntegrationLike {
  name: string;
  description: string;
  /** JSON Schema for the node's resolved `input` — machine-validated. */
  inputSchema: Record<string, unknown>;
  /** Compact TS-style output signature — documentation only. */
  outputSignature: string;
  /** Canonical input for example rendering in the generated docs. */
  exampleInput?: Record<string, unknown>;
  /** Whether invoking it changes the outside world (drives approval gating
   * and effect recording). */
  hasEffect: boolean;
  tags?: string[];
  /**
   * Deterministic mock: same input → same output, no IO.
   *
   * May return a promise — a connector authored in YAML runs its mock body
   * through the CodeRunner, which is async because the production backend is
   * wire-separated. Callers must await the result.
   */
  mock(input: unknown): unknown;
  live?(input: unknown, ctx: IntegrationContext): Promise<unknown>;
}

/**
 * A blob the host persisted on a connector's behalf. `id` is how the platform
 * addresses it afterwards; `url` is present only when the store can expose a
 * fetchable link, so bodies must treat it as optional.
 */
export interface StoredFileRef {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  url?: string;
}

/** One HTTP response, reduced to what a connector body may observe. */
export interface IntegrationHttpResponse {
  status: number;
  headers: Record<string, string>;
  json(): unknown;
  text(): string;
}

export interface IntegrationHttpRequest {
  headers?: Record<string, string>;
  body?: string;
  /** Ask the host to return the body base64-encoded — how a connector pulls
   * down an attachment it will hand to `files.store`. */
  responseType?: 'text' | 'base64';
}

/**
 * What a connector's LIVE body may reach. Everything here is host-provided and
 * mediated: the body never holds a socket, a credential record, or a file
 * handle — only these functions.
 *
 * The host is responsible for enforcing the connector's `allowedHosts` on
 * every request (an SSRF control that a body must not be able to opt out of),
 * for injecting the Authorization header the credential's auth method implies,
 * and for making `idempotencyKey` stable across a retried step so a re-run
 * cannot double-send.
 */
export interface IntegrationContext {
  /** Secret values the body places itself (vendor headers, body fields).
   * Tokens the platform injects as Authorization do NOT appear here. */
  secrets: { get(name: string): string };
  /** Stable across retries of the same step. */
  idempotencyKey: string;
  /**
   * The credential's API origin for a `per-credential` connector (https, no
   * trailing slash). Absent for fixed-endpoint connectors, whose bodies
   * hardcode their vendor URLs.
   */
  endpoint?: string;
  /**
   * The connector's non-secret per-credential settings (a mail server host and
   * port, an API version), as declared by its `configFields`. Values are
   * plain data, already defaulted and type-coerced by the host; secrets are
   * never here (they arrive through `secrets`).
   */
  config: Record<string, string | number | boolean>;
  http: {
    get(
      url: string,
      req?: IntegrationHttpRequest,
    ): Promise<IntegrationHttpResponse>;
    post(
      url: string,
      req?: IntegrationHttpRequest,
    ): Promise<IntegrationHttpResponse>;
    put(
      url: string,
      req?: IntegrationHttpRequest,
    ): Promise<IntegrationHttpResponse>;
    patch(
      url: string,
      req?: IntegrationHttpRequest,
    ): Promise<IntegrationHttpResponse>;
    delete(
      url: string,
      req?: IntegrationHttpRequest,
    ): Promise<IntegrationHttpResponse>;
  };
  /** Present when the caller can persist blobs; a body that needs it must say
   * so rather than assume it (attachment actions check and throw). */
  files?: {
    download(
      url: string,
      opts: { headers?: Record<string, string>; fileName: string },
    ): Promise<StoredFileRef>;
    store(
      data: string,
      opts: {
        encoding: 'base64' | 'utf-8';
        contentType: string;
        fileName: string;
      },
    ): Promise<StoredFileRef>;
  };
  base64Encode(input: string): string;
  base64Decode(input: string): string;
}

/**
 * What a host supplies per integration so the executor can build an
 * {@link IntegrationContext}. The engine adds the parts only it knows — the
 * resolved secrets and the retry-stable idempotency key.
 */
export type IntegrationHostCapabilities = Pick<
  IntegrationContext,
  'endpoint' | 'config' | 'http' | 'files' | 'base64Encode' | 'base64Decode'
>;

/**
 * What a node type's OUTPUT is to the reference system:
 *  - `structured`   — a typed shape callers may path into
 *                     (`nodes.x.output.<field>`).
 *  - `unstructured` — free text; only `nodes.x.output.text` exists, and only
 *                     into string context. Tools that declare no output
 *                     schema are unstructured by definition; the sanctioned
 *                     bridge to structured data is an `llm` node with
 *                     `outputSchema`.
 */
export type OutputKind = 'structured' | 'unstructured';

export interface NodeTypeDef {
  type: string;
  kind: 'core' | 'integration';
  description: string;
  outputKind: OutputKind;
  /** Allowed fields beyond id/type/control-flow. */
  allowedFields: string[];
  requiredFields: string[];
  integration?: IntegrationLike;
}

// The built-in node kinds. Connectors and platform natives (knowledge
// search, document ops, …) join the table at registration time.
const table = new Map<string, NodeTypeDef>([
  [
    'transform',
    {
      type: 'transform',
      kind: 'core',
      outputKind: 'structured',
      description:
        "Pure JavaScript for reshaping data (no network, no imports). `code` is a function body; `input` is this node's evaluated input object; it MUST return a value.",
      allowedFields: ['input', 'code'],
      requiredFields: ['code'],
    },
  ],
  [
    'llm',
    {
      type: 'llm',
      kind: 'core',
      // Without an outputSchema the node yields {text}; WITH one it yields
      // the schema-shaped object. Reference typing treats the schema-less
      // form as unstructured; validate/contracts refines per node.
      outputKind: 'unstructured',
      description:
        'Call a language model with a templated prompt. `model` is required and explicit. Output: {text: string} — or, with `outputSchema`, the schema-shaped object (the bridge from text to structured data).',
      allowedFields: ['prompt', 'system', 'model', 'outputSchema', 'input'],
      requiredFields: ['prompt', 'model'],
    },
  ],
  [
    'agent',
    {
      type: 'agent',
      kind: 'core',
      // The reply text is free-form, but the envelope is fixed — callers path
      // into .output.text / .output.files / .output.status, so the reference
      // system treats the node as structured.
      outputKind: 'structured',
      description:
        'Run one turn of an external coding agent (Claude Code, Codex, …) in the sandbox: it reads staged `files`, uses `skills` and brokered `connectors`, and writes artifacts. `model` is required and explicit. Output: {text, files: [{name, storageId, size, contentType}], status}. Use `llm` for a one-shot completion; use `agent` only when the step needs tools, files, or multiple turns.',
      allowedFields: [
        'prompt',
        'system',
        'model',
        'harness',
        'skills',
        'connectors',
        'files',
        'input',
      ],
      requiredFields: ['prompt', 'model'],
    },
  ],
  [
    'subautomation',
    {
      type: 'subautomation',
      kind: 'core',
      outputKind: 'structured',
      description:
        'Run a saved automation as a node. `automation` is "name" or "name@version" (default: deployed/latest); `input` becomes its runtime input; output is its output. Nesting max 3.',
      allowedFields: ['automation', 'input'],
      requiredFields: ['automation'],
    },
  ],
]);

export function registerNodeType(def: NodeTypeDef): void {
  table.set(def.type, def);
}

export function nodeTypes(): ReadonlyMap<string, NodeTypeDef> {
  return table;
}

export function typeNames(): string[] {
  return [...table.keys()];
}

// -------------------------------------------------------------------- store

/**
 * Where saved automations live. Async by contract: production stores sit
 * behind a database. Versions are immutable; `deployedVersion` names the one
 * version triggers run.
 */
export interface StoreAdapter {
  list(): Promise<Array<{ name: string; latest: number }>>;
  get(
    name: string,
    version?: number,
  ): Promise<{ meta: { version: number }; automation: unknown } | null>;
  deployedVersion(name: string): Promise<number | null>;
}

let store: StoreAdapter | null = null;

export function setStoreAdapter(adapter: StoreAdapter): void {
  store = adapter;
}

export function storeAdapter(): StoreAdapter | null {
  return store;
}

// ---------------------------------------------------------------------- llm

/**
 * The language-model seam for `llm` nodes. The model is always the node's
 * own explicit choice; the service resolves access and wire details. With
 * `outputSchema` the service must return `{data}` satisfying the schema
 * (hosts enforce; the engine validates shape only), otherwise `{text}`.
 * When no service is installed, execution uses a deterministic mock.
 */
export interface LlmService {
  (args: {
    model: string;
    prompt: string;
    system?: string;
    outputSchema?: Record<string, unknown>;
  }): Promise<{ text: string } | { data: unknown }>;
}

let llm: LlmService | null = null;

export function setLlmService(service: LlmService): void {
  llm = service;
}

export function llmService(): LlmService | null {
  return llm;
}

// -------------------------------------------------------------------- agent

/** A file an agent turn produced, as the host harvested and stored it. */
export interface AgentFileRef {
  name: string;
  storageId?: string;
  size?: number;
  contentType?: string;
}

/** What an `agent` node hands the service: the resolved prompt pair, the
 * explicit model, and the declared capability surface. `files` values are
 * host-interpreted references (folder/document ids); the engine only
 * resolves the templates inside them. */
export interface AgentTurnRequest {
  model: string;
  prompt: string;
  system?: string;
  harness?: string;
  skills?: string[];
  connectors?: string[];
  files?: Record<string, unknown>;
  input?: unknown;
}

/** The fixed output envelope of an `agent` node. */
export interface AgentTurnResult {
  text: string;
  files?: AgentFileRef[];
  status?: string;
}

/**
 * The external-agent seam for `agent` nodes — the sibling of {@link LlmService}.
 * The host runs the turn in its sandbox (staging, harness exec, harvest) and
 * returns the settled envelope. When no service is installed, execution uses
 * a deterministic mock, so documents stay testable without a sandbox.
 */
export interface AgentService {
  (args: AgentTurnRequest): Promise<AgentTurnResult>;
}

let agent: AgentService | null = null;

export function setAgentService(service: AgentService | null): void {
  agent = service;
}

export function agentService(): AgentService | null {
  return agent;
}
