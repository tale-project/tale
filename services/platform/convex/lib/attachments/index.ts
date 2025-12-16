/**
 * Shared attachment utilities for AI agents.
 *
 * This module provides reusable functions for handling file attachments
 * in agent conversations. It supports:
 * - Images: sent directly to AI as multi-modal content (inline)
 * - Non-image files (PDFs, docs, etc.): provide URL and let AI use tools to process
 */

// Types
export type {
  FileAttachment,
  RegisteredFile,
  MessageContentPart,
  MultiModalContent,
} from './types';

// Functions
export { registerFilesWithAgent } from './register_files';
export { buildMultiModalContent } from './build_multi_modal_content';
export { formatAttachmentsAsMarkdown } from './format_markdown';

