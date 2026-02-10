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
  'customer_read',
  'product_read',
  'rag_search',
  'web',
  'pdf',
  'image',
  'pptx',
  'docx',
  'txt',
  'resource_check',
  'workflow_read',
  'workflow_examples',
  'update_workflow_step',
  'save_workflow_definition',
  'create_workflow',
  'generate_excel',
  'integration',
  'integration_batch',
  'integration_introspect',
  'verify_approval',
  'database_schema',
  'workflow_assistant',
  'web_assistant',
  'document_assistant',
  'integration_assistant',
  'crm_assistant',
  'request_human_input',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
