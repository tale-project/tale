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
 * `backends.ts` holds the adapter that must not be re-implemented: an
 * automation always goes through the automations store.
 */

export {
  createAutomationsBackend,
  type AutomationsBackendOptions,
} from './backends';
export {
  CAPABILITY_KINDS,
  CAPABILITY_METHODS,
  CapabilityRegistry,
  createCapabilitySurface,
  isUnstructured,
  type AutomationInvocation,
  type BackendResult,
  type Capability,
  type CapabilityAuditEntry,
  type CapabilityAuditSink,
  type CapabilityBackends,
  type CapabilityKind,
  type CapabilityMethod,
  type CapabilitySearchHit,
  type CapabilitySurface,
  type CapabilitySurfaceDeps,
  type InvokeCapabilityParams,
  type InvokeResult,
  type KnowledgeBackend,
  type KnowledgePassage,
  type KnowledgeRequest,
  type KnowledgeResult,
  type MemoryRecord,
  type MemorySaveRequest,
  type MemorySearchRequest,
  type MemoryStore,
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
  fitSamplingToWindow,
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
  createPiiTokenizeFilter,
  runGuardrailChain,
  type GuardrailChainResult,
  type GuardrailFailBehavior,
  type GuardrailFilter,
  type GuardrailOutcomeEvent,
  type GuardrailRefusal,
  type ModerationBackend,
  type ModerationErrorClass,
  type ModerationExtras,
  type ModerationOutcome,
  type ModerationRun,
  type OutputGuardrailTransform,
} from './guardrails';
export { CHAT_ASSISTANT, CHAT_ASSISTANT_SLUG } from './assistant';
export {
  MODEL_BANDS,
  assessPromptBand,
  type ModelBand,
  type PromptBandAssessment,
  type PromptBandFacts,
} from './model-band';
export {
  PREFERRED_CHAT_MODELS,
  chooseChatModel,
  eligibleChatCandidates,
  type ChatAutoRefusal,
  type ChatModelChoice,
} from './model-choice';
export {
  CHAT_TOOL_DOCS,
  CHAT_TOOL_NAMES,
  CHAT_WIRE_TOOLS,
  PAUSING_CHAT_TOOLS,
  RAG_SEARCH_ACTIONS,
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_KINDS,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_STATUS_VALUES,
  isAwaitingAnswerResult,
  RAG_SEARCH_MIN_SIMILARITY,
  isChatToolName,
  isPausingChatTool,
  type AwaitingAnswerResult,
  type ChatToolExecutor,
  type ChatToolName,
  type RagSearchAction,
  type RagSearchKind,
  type RagSearchStatus,
  type ToolCallRequest,
  type WireTool,
} from './tools';
export {
  MAX_TOOL_ROUNDS,
  TURN_STEPS,
  assembleTurnContext,
  estimateCostCents,
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
