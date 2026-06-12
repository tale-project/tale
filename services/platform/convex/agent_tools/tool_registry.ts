/**
 * LLM Tools Registry
 *
 * Central registry for all LLM tools.
 * Array-based registry for type inference, with derived object for O(1) lookups.
 */

import { conversationReadTool } from './conversations/conversation_read_tool';
import { customerReadTool } from './customers/customer_read_tool';
import { databaseSchemaTool } from './database/database_schema_tool';
import { documentFindTool } from './documents/document_find_tool';
import { documentRetrieveTool } from './documents/document_retrieve_tool';
import { documentWriteTool } from './documents/document_write_tool';
import { docxTool } from './files/docx_tool';
import { excelTool } from './files/excel_tool';
import { fileDeleteTool } from './files/file_delete_tool';
import { fileEditTool } from './files/file_edit_tool';
import { fileListTool } from './files/file_list_tool';
import { fileReadTool } from './files/file_read_tool';
import { fileWriteTool } from './files/file_write_tool';
import { generateImageTool } from './files/generate_image_tool';
import { imageTool } from './files/image_tool';
import { pdfTool } from './files/pdf_tool';
import { textTool } from './files/text_tool';
import { requestHumanInputTool } from './human_input/request_human_input_tool';
import { integrationBatchTool } from './integrations/integration_batch_tool';
import { integrationIntrospectTool } from './integrations/integration_introspect_tool';
import { integrationTool } from './integrations/integration_tool';
import { requestUserLocationTool } from './location/request_user_location_tool';
import { proposeMemoryTool } from './memory/propose_memory_tool';
import { organigramReadTool } from './organigram/organigram_read_tool';
import { organigramWriteTool } from './organigram/organigram_write_tool';
import { productReadTool } from './products/product_read_tool';
import { knowledgeWriteTool } from './rag/knowledge_write_tool';
import { ragSearchTool } from './rag/rag_search_tool';
import { runCodeTool } from './run_code_tool';
import { secretReadTool } from './secrets/secret_read_tool';
import { projectReadTool } from './tasks/project_read_tool';
import { projectWriteTool } from './tasks/project_write_tool';
import { taskReadTool } from './tasks/task_read_tool';
import { taskWriteTool } from './tasks/task_write_tool';
import type { ToolName } from './tool_names';
import type { ToolDefinition } from './types';
import { updateTodosTool } from './update_todos/update_todos_tool';
import { webTool } from './web/web_tool';
import { createWorkflowTool } from './workflows/create_workflow_tool';
import { runWorkflowTool } from './workflows/run_workflow_tool';
import { saveWorkflowDefinitionTool } from './workflows/save_workflow_definition_tool';
import { updateWorkflowStepTool } from './workflows/update_workflow_step_tool';
import { workflowReadTool } from './workflows/workflow_read_tool';
import { workflowSyntaxTool } from './workflows/workflow_syntax_tool';

// Re-export from leaf module so existing consumers don't need to change imports
export { TOOL_NAMES, type ToolName } from './tool_names';

/**
 * Tool registry as array - enables TypeScript to infer tool names
 */
export const TOOL_REGISTRY = [
  fileWriteTool,
  fileEditTool,
  fileReadTool,
  fileListTool,
  fileDeleteTool,
  runCodeTool,
  customerReadTool,
  productReadTool,
  ragSearchTool,
  knowledgeWriteTool,
  webTool,
  workflowReadTool,
  workflowSyntaxTool,
  updateWorkflowStepTool,
  saveWorkflowDefinitionTool,
  createWorkflowTool,
  runWorkflowTool,
  excelTool,
  pdfTool,
  imageTool,
  generateImageTool,
  docxTool,
  textTool,
  integrationTool,
  integrationBatchTool,
  integrationIntrospectTool,
  databaseSchemaTool,
  requestHumanInputTool,
  documentFindTool,
  documentRetrieveTool,
  documentWriteTool,
  requestUserLocationTool,
  conversationReadTool,
  updateTodosTool,
  proposeMemoryTool,
  organigramReadTool,
  organigramWriteTool,
  taskReadTool,
  taskWriteTool,
  projectReadTool,
  projectWriteTool,
  secretReadTool,
] as const;

/**
 * Derived object for O(1) lookups by tool name.
 * Lazily computed to avoid circular dependency issues at module init time.
 */
let _toolRegistryMap: Record<ToolName, ToolDefinition> | null = null;

export function getToolRegistryMap(): Record<ToolName, ToolDefinition> {
  if (!_toolRegistryMap) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TOOL_REGISTRY is the source of truth for ToolName; Object.fromEntries loses the key type
    _toolRegistryMap = Object.fromEntries(
      TOOL_REGISTRY.map((tool: ToolDefinition) => [tool.name, tool]),
    ) as Record<ToolName, ToolDefinition>;
  }
  return _toolRegistryMap;
}
