/**
 * Core data model — the stable public types of the automation engine.
 *
 * An automation is a single document: a DAG of typed nodes. Edges are DERIVED
 * from `{{ nodes.<id>.output }}` references, never declared — one source of
 * truth that maps 1:1 onto a visual canvas (node = box, reference = edge,
 * control-flow fields = badges). No logic exists outside nodes.
 *
 * Documents are YAML-first (agents author YAML far more reliably than JSON),
 * and every API equally accepts the equivalent JSON object.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

/**
 * One node of the graph. Exactly one behavior per `type`:
 *  - `transform`      — sandboxed JavaScript over its resolved `input`
 *  - `llm`            — language-model call with a templated prompt and an
 *                       explicit, caller-chosen model
 *  - `agent`          — one turn of an external coding agent in the sandbox,
 *                       with staged files, skills and brokered connectors
 *  - `subautomation`  — run a saved automation as a node
 *  - any registered capability name (connector actions, platform natives
 *    such as knowledge search) — an external connector
 */
export interface NodeDef {
  /** Unique within the automation; `^[a-z][a-z0-9_]{0,49}$`. */
  id: string;
  type: string;

  // Declarative control flow — the engine owns iteration and branching so
  // per-item work stays visible in the trace instead of hiding inside code.
  /** Skip the node when this template is falsy; dependents skip too. */
  when?: string;
  /** Run exactly when the named node was `when`-skipped (exclusive else). */
  elseOf?: string;
  /** Template resolving to an array: run once per item; the node's output
   * becomes the array of per-item outputs. */
  forEach?: string;
  /** Re-run the node until this template is truthy (`output` in scope). */
  repeatUntil?: string;
  /** Iteration cap for `repeatUntil` (default 5, max 20). */
  maxRepeats?: number;
  /** `fail` (default) halts the run; `continue` records the error and skips
   * dependents. */
  onError?: 'fail' | 'continue';

  // Per-type payloads.
  /** Connector/transform input mapping; template strings allowed in
   * values. */
  input?: Record<string, unknown>;
  /** transform: a JavaScript function body over `input`/`nodes` (+ `item`
   * and `index` under forEach); it MUST return a value. */
  code?: string;
  /** llm/agent: the user prompt template. */
  prompt?: string;
  /** llm/agent: optional system prompt. */
  system?: string;
  /**
   * llm/agent: the model to call — REQUIRED and always explicit. The engine
   * never picks a model on the author's behalf; availability and access are
   * the host's concern.
   */
  model?: string;
  /**
   * llm: when present, a JSON Schema the reply must satisfy — the node's
   * output becomes the parsed object instead of `{text}`. This is the one
   * sanctioned bridge from unstructured text to structured data.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * agent: the coding-agent harness that runs the turn (`claude-code`,
   * `codex`, …). Optional — the host's default harness applies when absent.
   */
  harness?: string;
  /** agent: org skill slugs staged into the session before the turn. */
  skills?: string[];
  /** agent: connector slugs the turn may reach through the broker. */
  connectors?: string[];
  /** agent: platform workspace-tool grants beyond the baseline — the task
   * family and document_create (`AGENT_TOOL_CATALOG`). A write grant is the
   * standing authorization for that write. */
  tools?: string[];
  /** agent: names of org `agentSecrets` injected as environment variables for
   * the turn (BYO API keys for services with no shipped connector). */
  secrets?: string[];
  /**
   * agent: workspace staging map — mount name → a document/folder reference
   * (templates allowed in values). The host stages each entry under the
   * session workspace before the turn starts.
   */
  files?: Record<string, unknown>;
  /** subautomation: a saved reference, `"name"` or `"name@version"`. */
  automation?: string;
}

/** A first-class acceptance test stored with the automation. */
export interface AutomationTest {
  name: string;
  input: Json;
  expect?: {
    output?: unknown;
    /** Each listed effect must occur; `input` is compared deeply when
     * given. */
    effects?: Array<{ connector: string; input?: unknown }>;
  };
}

export interface Automation {
  /** Document schema version; v1 documents declare `version: 1`. */
  version?: number;
  /** Kebab-case; also the store identity. */
  name: string;
  description?: string;
  /** JSON Schema for the runtime input. */
  inputs?: Record<string, unknown>;
  nodes: NodeDef[];
  /** The automation's return value; templates allowed anywhere inside. */
  output?: unknown;
  tests?: AutomationTest[];
  /** Canvas metadata (e.g. `{positions}`); ignored by the engine. */
  ui?: Record<string, unknown>;
}

/**
 * Validation issue. Error text is public API and golden-tested: agents parse
 * it behaviorally, so every issue carries a machine-readable code and,
 * wherever possible, an actionable hint — errors are the author's primary
 * feedback signal, and hints double as catalog discovery.
 */
export interface Issue {
  level: 'error' | 'warning';
  code: string;
  nodeId?: string;
  path?: string;
  message: string;
  hint?: string;
}

export type NodeStatus = 'ok' | 'skipped' | 'error' | 'not_run';

/** Per-node runtime record — authors read these to learn real data shapes. */
export interface NodeTrace {
  node: string;
  type: string;
  status: NodeStatus;
  /** Resolved input after template evaluation. */
  input?: unknown;
  output?: unknown;
  note?: string;
  error?: string;
  ms?: number;
}

/** An external side effect (message sent, record written, model called…) in
 * execution order. */
export interface Effect {
  node: string;
  connector: string;
  input: unknown;
}

export interface RunError {
  nodeId?: string;
  message: string;
  hint?: string;
}

export interface RunResult {
  status: 'success' | 'error' | 'invalid';
  output?: unknown;
  error?: RunError;
  trace: NodeTrace[];
  effects: Effect[];
  validation?: { errors: Issue[]; warnings: Issue[] };
}
