/**
 * Tool Names
 *
 * Extracted to its own module so lightweight consumers (queries, validators)
 * can import tool names without pulling in the full tool registry and its
 * heavy transitive dependencies (Node.js-only helpers, AI SDKs, etc.).
 *
 * This breaks a circular dependency:
 *   tool_registry → workflow tools → validation → steps/llm → tool_registry
 */

export const TOOL_NAMES = [
  'file_write',
  'file_edit',
  'file_read',
  'file_list',
  'file_delete',
  'run_code',
  'customer_read',
  'product_read',
  'rag_search',
  'knowledge_write',
  'web',
  'pdf',
  'image',
  'generate_image',
  'docx',
  'text',
  'workflow_read',
  'workflow_syntax',
  'update_workflow_step',
  'save_workflow_definition',
  'create_workflow',
  'run_workflow',
  'excel',
  'integration',
  'integration_batch',
  'integration_introspect',
  'database_schema',
  'request_human_input',
  'document_find',
  'document_retrieve',
  'document_write',
  'request_user_location',
  'conversation_read',
  'update_todos',
  'propose_memory',
  'organigram_read',
  'organigram_write',
  'task_read',
  'task_write',
  'project_read',
  'project_write',
  'secret_read',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
