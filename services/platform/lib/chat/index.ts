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
  CapabilityRegistry,
  createCapabilitySurface,
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
  type AgentInstructions,
  type AssembledContext,
  type ContextBlock,
  type ContextBlockId,
  type ContextBudget,
  type ContextInput,
  type ContextTruncation,
  type ToolDoc,
} from './context';
export { type ReasoningEffort, type TurnSampling } from './effort';
export {
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
export { CHAT_ASSISTANT_SLUG } from './assistant';
export {
  assessPromptBand,
  type ModelBand,
  type PromptBandAssessment,
  type PromptBandFacts,
} from './model-band';
export {
  chooseChatModel,
  eligibleChatCandidates,
  type ChatAutoRefusal,
  type ChatModelChoice,
} from './model-choice';
export {
  CHAT_TOOL_NAMES,
  CHAT_WIRE_TOOLS,
  RAG_SEARCH_DEFAULT_LIMIT,
  RAG_SEARCH_ENTITY_LIMIT,
  RAG_SEARCH_KINDS,
  RAG_SEARCH_MAX_LIMIT,
  RAG_SEARCH_STATUS_VALUES,
  RAG_SEARCH_MIN_SIMILARITY,
  type AwaitingAnswerResult,
  type ChatToolExecutor,
  type ChatToolName,
  type RagSearchKind,
  type RagSearchStatus,
  type ToolCallRequest,
  type WireTool,
} from './tools';
export {
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
  type ChatMessage,
  type MessagePart,
  type MessageRole,
  type TurnUsage,
} from './types';
