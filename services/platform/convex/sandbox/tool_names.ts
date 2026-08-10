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
 * The baseline knowledge-retrieval pair every managed agent run is granted —
 * task-agent turns and automation agent turns alike: semantic search over the
 * organization's knowledge plus the windowed fetch of one source a hit named.
 * Read-only, and the grant alone never widens visibility: the dispatch
 * derives what a call may read from the SESSION's binding (a project-bound
 * run reads its project + the org hub; an org-level automation run reads the
 * hub only), so a run sees exactly what its deployment surface owns.
 */
export const KNOWLEDGE_READ_TOOLS = ['rag_search', 'rag_fetch'] as const;

/** The instructions line that makes the knowledge pair discoverable — the
 * shim only advertises generic `workspace_tool`, so the turn is told the
 * names (the same reason the ask_human guidance exists). Shared by every
 * lane that grants {@link KNOWLEDGE_READ_TOOLS}. */
export const KNOWLEDGE_TOOLS_GUIDANCE =
  "The organization's knowledge base is available through the " +
  '"workspace_tool" MCP tool: rag_search {query} finds the most relevant ' +
  "passages, rag_fetch {ref} reads one hit's full source (a document file " +
  'id or a crawled page URL). Use them when you need organization facts ' +
  'that are not in your staged files; call workspace_status to see ' +
  'everything granted.';

/**
 * Knowledge refs kept per recorded tool call (`sandboxToolCalls.knowledgeRefs`
 * — the read-set the provenance ledger folds into a run's settle entry).
 * Order-preserving truncation: the first N distinct refs of a result are the
 * ones a model most plausibly used, and an unbounded list would let one broad
 * search bloat the audit row. Shared here because the `'use node'` dispatch
 * truncates and the V8 ledger writer enforces the same bound.
 */
export const KNOWLEDGE_REFS_PER_CALL_CAP = 20;
