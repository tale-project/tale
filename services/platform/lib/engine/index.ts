/**
 * The workflow engine — public surface.
 *
 * A host assembles a working engine by installing the slots (a CodeRunner
 * for untrusted JS, optionally a StoreAdapter, an LlmService, and any
 * capability node types) and then driving everything through `dispatch`. The
 * core stays pure: it imports no `node:*`, no Bun globals, and no Convex —
 * the layering is enforced by `selftest/purity.test.ts`.
 */

export type {
  Effect,
  Issue,
  Json,
  NodeDef,
  NodeStatus,
  NodeTrace,
  RunError,
  RunResult,
  Workflow,
  WorkflowTest,
} from './core/types';
export { CODES, type IssueCode } from './core/errors';
export {
  hasCodeRunner,
  llmService,
  nodeTypes,
  registerNodeType,
  setCodeRunner,
  setLlmService,
  setStoreAdapter,
  storeAdapter,
  typeNames,
  type CodeRunner,
  type IntegrationLike,
  type LlmService,
  type NodeTypeDef,
  type OutputKind,
  type RunnerLimits,
  type StoreAdapter,
} from './core/slots';
export { validate } from './core/validate';
export { execute, type ExecuteOptions } from './core/execute';
export {
  isParseFailure,
  parseAgentReply,
  repairJson,
  type AgentAction,
  type ParsedReply,
} from './core/repair';
export { nodeVmRunner } from './runners/node-vm';
export { memoryStore, type MemoryStore } from './store/memory';
export { agentDocs, DOC_EXAMPLE } from './api/docs';
export { searchCatalog, allIntegrations } from './api/catalog-search';
export { runWorkflowTests, type TestReport } from './api/tests';
export {
  dispatch,
  METHODS,
  type DispatchContext,
  type DispatchStore,
  type Method,
  type TriggerSpec,
} from './api/dispatch';
