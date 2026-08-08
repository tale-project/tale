/**
 * Workspace-tool names shared across runtimes. The dispatch bridge that
 * implements them is `'use node'`; the HTTP face that gates them is not — a
 * name both sides compare against therefore lives here, importable from
 * either.
 */

/**
 * The ask-a-human tool of an automation agent turn: registers a question for
 * the run's operator, then the agent ends its turn and is resumed with the
 * answer. Granted ONLY on the workflow-agent lane — a chat turn's user is
 * already present, so asking "a human" there is just asking the chat.
 */
export const ASK_HUMAN_TOOL = 'ask_human';

/**
 * Knowledge refs kept per recorded tool call (`sandboxToolCalls.knowledgeRefs`
 * — the read-set the provenance ledger folds into a run's settle entry).
 * Order-preserving truncation: the first N distinct refs of a result are the
 * ones a model most plausibly used, and an unbounded list would let one broad
 * search bloat the audit row. Shared here because the `'use node'` dispatch
 * truncates and the V8 ledger writer enforces the same bound.
 */
export const KNOWLEDGE_REFS_PER_CALL_CAP = 20;
