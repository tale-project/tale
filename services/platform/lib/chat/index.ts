/**
 * The chat library — public surface.
 *
 * Three pieces, in the order a turn uses them:
 *
 *  1. `turn.ts` — the pipeline: input guardrails → resolve agent + execution →
 *     assemble context → stream → output guardrails → usage ledger → done.
 *     Every outside dependency is injected, so a turn runs in a unit test.
 *  2. `context.ts` — the context contract: exactly which blocks the model
 *     gets, in exactly which order, with the prompt-cache breakpoint between
 *     the stable prefix and the volatile tail.
 *  3. `capabilities.ts` — one registry and one dispatcher for everything the
 *     model can call, plus the knowledge seam and the memory tool.
 *
 * `backends.ts` holds the two adapters that must not be re-implemented: an
 * integration action always goes through the integrations dispatcher, and an
 * automation always goes through the automations store.
 */

export {
  createAutomationsBackend,
  createIntegrationBackend,
  type AutomationsBackendOptions,
  type IntegrationBackendOptions,
} from './backends';
export {
  CAPABILITY_KINDS,
  CAPABILITY_METHODS,
  CapabilityRegistry,
  EVENT_ONLY_NOTE,
  KNOWLEDGE_UNAVAILABLE_REASON,
  capabilityDocs,
  createCapabilitySurface,
  isEventOnlyAutomation,
  isUnstructured,
  mcpToolsToCapabilities,
  type AutomationInvocation,
  type BackendResult,
  type BuiltinInvocation,
  type Capability,
  type CapabilityAuditEntry,
  type CapabilityAuditSink,
  type CapabilityBackends,
  type CapabilityKind,
  type CapabilityMethod,
  type CapabilitySearchHit,
  type CapabilitySurface,
  type CapabilitySurfaceDeps,
  type IntegrationInvocation,
  type InvokeCapabilityParams,
  type InvokeResult,
  type KnowledgeBackend,
  type KnowledgePassage,
  type KnowledgeRequest,
  type KnowledgeResult,
  type McpInvocation,
  type McpToolDefinition,
  type MemoryRecord,
  type MemorySaveRequest,
  type MemorySearchRequest,
  type MemoryStore,
  type SkillInvocation,
} from './capabilities';
export {
  CONTEXT_BLOCK_ORDER,
  assembleContext,
  resolveAgentInstructions,
  truncationNotice,
  type AgentInstructions,
  type AssembledContext,
  type ContextBlock,
  type ContextBlockId,
  type ContextBudget,
  type ContextInput,
  type ContextTruncation,
  type ToolDoc,
} from './context';
export { deriveFallbackTitle } from './derive-fallback-title';
export {
  EFFORT_LEVELS,
  isReasoningEffort,
  resolveTurnSampling,
  type ReasoningEffort,
  type TurnSampling,
} from './effort';
export {
  DEFAULT_FAIL_BEHAVIOR,
  GUARDRAIL_CHAIN_ORDER,
  createChatFilter,
  createModerationFilter,
  createOutputTransform,
  createPiiFilter,
  runGuardrailChain,
  type GuardrailChainResult,
  type GuardrailFailBehavior,
  type GuardrailFilter,
  type GuardrailRefusal,
  type ModerationBackend,
  type OutputGuardrailTransform,
} from './guardrails';
export {
  TURN_STEPS,
  assembleTurnContext,
  recordUsage,
  resolveAgentAndExecution,
  runInputGuardrails,
  runTurn,
  streamWithOutputGuardrails,
  type ModelCall,
  type ModelCallRequest,
  type ModelStreamChunk,
  type ResolvedAgent,
  type TurnDeps,
  type TurnOutcome,
  type TurnRequest,
  type TurnStep,
  type TurnStore,
  type UsageLedger,
  type UsageLedgerEntry,
} from './turn';
export {
  estimateTokens,
  messageText,
  type ChatMessage,
  type MessagePart,
  type MessageRole,
  type TurnUsage,
} from './types';
