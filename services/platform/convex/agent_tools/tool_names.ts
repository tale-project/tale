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
  'image',
  'generate_image',
  'workflow_read',
  'workflow_syntax',
  'update_workflow_step',
  'save_workflow_definition',
  'create_workflow',
  'run_workflow',
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
  'conversation_write',
  'customer_write',
  'product_write',
  'website_read',
  'website_write',
  'vendor_read',
  'vendor_write',
  'discussion_read',
  'discussion_write',
  'agent_read',
  'agent_write',
  'metrics_read',
  'update_todos',
  'propose_memory',
  'task_read',
  'task_write',
  'project_read',
  'project_write',
  'secret_read',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
